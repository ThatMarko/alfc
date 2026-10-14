import type { Args } from "../../../common/types";
import { isCompiledBinary } from "../../utils/consts";
import type {
  HardwareOperation,
  HardwareRequest,
  HardwareResponse,
} from "./hardware-protocol";

type ChannelName = "wmi" | "cpuoc";
type FailureListener = (channel: ChannelName, error: Error) => void;
type PendingRequest = {
  resolve: (result: number | string | undefined) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const failureListeners = new Set<FailureListener>();

export function onHardwareFailure(listener: FailureListener) {
  failureListeners.add(listener);
  return () => failureListeners.delete(listener);
}

class HardwareChannel {
  private pending = new Map<number, PendingRequest>();
  private nextId = 0;
  private worker: Worker | undefined;
  private failure: Error | undefined;
  private closed = false;
  private cleanupPromise: Promise<void> | undefined;

  constructor(private readonly name: ChannelName) {}

  private fail(error: Error) {
    if (!this.failure) {
      this.failure = Object.assign(
        new Error(
          `RESTART_REQUIRED: Windows ${this.name} hardware failed: ${error.message}`,
        ),
        { restartRequired: true, channel: this.name },
      );
      for (const listener of failureListeners) {
        try {
          listener(this.name, this.failure);
        } catch (listenerError) {
          console.error(
            "[Native] Failed to report hardware failure:",
            listenerError,
          );
        }
      }
    }
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(this.failure);
    }
    this.pending.clear();
    // Native AOT libraries cannot be unloaded. Keep the CPU worker and its
    // DLL rooted until process exit even if a native operation is stuck.
    this.worker?.unref();
    if (this.name === "wmi") this.worker?.terminate();
  }

  private requireWorker() {
    if (this.failure) throw this.failure;
    if (this.closed)
      throw new Error(`Windows ${this.name} hardware services are closed`);
    if (!this.worker) {
      const workerPath = isCompiledBinary
        ? "./native/windows/hardware.worker.js"
        : "./hardware.worker.ts";
      this.worker = new Worker(new URL(workerPath, import.meta.url).href);
      this.worker.onmessage = (event: MessageEvent<HardwareResponse>) => {
        const response = event.data;
        const request = this.pending.get(response.id);
        if (!request) return;
        if (!response.ok && response.restartRequired) {
          this.fail(new Error(response.error));
          return;
        }
        this.pending.delete(response.id);
        clearTimeout(request.timer);
        if (response.ok) request.resolve(response.result);
        else request.reject(new Error(response.error));
      };
      this.worker.onerror = (event) => {
        event.preventDefault();
        this.fail(new Error(`hardware worker failed: ${event.message}`));
      };
      this.worker.addEventListener("close", () => {
        if (!this.closed && !this.failure) {
          this.fail(new Error("hardware worker exited unexpectedly"));
        }
      });
    }
    return this.worker;
  }

  request(operation: HardwareOperation, timeout = 5000) {
    if (
      this.cleanupPromise &&
      operation.kind !== "cleanupWmi" &&
      operation.kind !== "cleanupCpu"
    ) {
      return Promise.reject(
        new Error(`Windows ${this.name} hardware services are closing`),
      );
    }
    return new Promise<number | string | undefined>((resolve, reject) => {
      const current = this.requireWorker();
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.fail(
          new Error(
            `${operation.kind} timed out; restart ALFC to recover safely`,
          ),
        );
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        current.postMessage({ id, operation } satisfies HardwareRequest);
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  cleanup() {
    this.cleanupPromise ??= (async () => {
      if (this.closed) return;
      if (this.name === "cpuoc") {
        // There is nothing to unload or restore in the Native AOT adapter.
        // In particular, never terminate its worker while the runtime lives.
        this.closed = true;
        this.worker?.unref();
        for (const request of this.pending.values()) {
          clearTimeout(request.timer);
          request.reject(new Error("Windows CPU tuning services are closed"));
        }
        this.pending.clear();
        return;
      }
      try {
        if (this.worker && !this.failure) {
          await this.request(
            { kind: this.name === "wmi" ? "cleanupWmi" : "cleanupCpu" },
            2000,
          );
        }
      } finally {
        this.closed = true;
        this.worker?.unref();
        if (this.name === "wmi") this.worker?.terminate();
      }
    })();
    return this.cleanupPromise;
  }
}

// Optional XTU failures must not take down fan control or BIOS restoration.
// Each DLL is initialized, called and cleaned up on its own owning thread.
const wmi = new HardwareChannel("wmi");
const cpuoc = new HardwareChannel("cpuoc");

export async function wmiInit() {
  await wmi.request({ kind: "wmiInit" }, 20_000);
}

export async function tuneInit() {
  await cpuoc.request({ kind: "tuneInit" });
}

export async function getCall(
  methodId: string,
  methodName: string,
  args?: Args,
) {
  const result = await wmi.request({ kind: "get", methodId, methodName, args });
  if (typeof result !== "number" && typeof result !== "string") {
    throw new Error("Windows hardware returned an invalid get result");
  }
  return result;
}

export async function setCall(
  methodId: string,
  methodName: string,
  args: Args,
) {
  await wmi.request({ kind: "set", methodId, methodName, args });
}

export async function tune(pl1: number, pl2: number) {
  await cpuoc.request({ kind: "tune", pl1, pl2 });
}

export function wmiCleanup() {
  return wmi.cleanup();
}

export function cpuocCleanup() {
  return cpuoc.cleanup();
}
