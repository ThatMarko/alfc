/** Explicit test entrypoint. Never included in production builds or installers. */
import { mock } from "bun:test";
import path from "node:path";
import { createInterface } from "node:readline";
import type { Args } from "../common/types";

if (process.platform !== "linux") {
  throw new Error(
    "The integration fixture requires Linux: only Linux hardware adapters are replaced.",
  );
}

const sandbox = process.argv[2];
const assets = process.argv[3];
if (!sandbox || !assets)
  throw new Error("Expected disposable source tree and built frontend paths");
if (process.env.NODE_ENV !== "production")
  throw new Error("Persistence must be enabled in this fixture");

type Call = { method: string; args?: Args };
const calls: Call[] = [];
let releaseWrite: (() => void) | undefined;
let heldWrite: Promise<void> | undefined;
let holdNextWrite = false;
let cpuFailed = false;
let failureListener:
  ((channel: "wmi" | "cpuoc", error: Error) => void) | undefined;
const report = (event: Record<string, unknown>) =>
  console.log(JSON.stringify({ alfcFixture: true, ...event }));

// Only the platform adapters are substituted. The real native queues,
// capability-failure reporter, paired fan writes, protocol handlers, state
// loader and atomic persistence execute unchanged from the staged source tree.
mock.module(path.join(sandbox, "server/native/linux/acpi.ts"), () => ({
  isAvailable: () => Promise.resolve(true),
  wmiInit: () => Promise.resolve(),
  wmiCleanup: () => {
    calls.push({ method: "wmiCleanup" });
  },
  onHardwareFailure: (listener: typeof failureListener) => {
    failureListener = listener;
    return () => {
      failureListener = undefined;
    };
  },
  getCall: (_methodId: string, method: string) => {
    calls.push({ method });
    return Promise.resolve(method === "getCpuTemp" ? 48 : 46);
  },
  setCall: async (_methodId: string, method: string, args: Args) => {
    calls.push({ method, args: { ...args } });
    if (method === "SetFixedFanSpeed" && holdNextWrite) {
      holdNextWrite = false;
      heldWrite = new Promise<void>((resolve) => {
        releaseWrite = resolve;
      });
      report({ event: "write-held" });
      await heldWrite;
      heldWrite = undefined;
      releaseWrite = undefined;
    }
  },
}));
mock.module(path.join(sandbox, "server/native/linux/cpuoc.ts"), () => ({
  tuneInit: () => Promise.resolve(),
  cpuocCleanup: () => {
    calls.push({ method: "cpuocCleanup" });
  },
  tune: (pl1: number, pl2: number) => {
    calls.push({ method: "tune", args: { pl1, pl2 } });
    if (cpuFailed) {
      const error = Object.assign(
        new Error("Deterministic CPU channel failure"),
        { restartRequired: true },
      );
      return Promise.reject(error);
    }
    return Promise.resolve();
  },
}));

const native = (await import(
  path.join(sandbox, "server/native/index.ts")
)) as typeof import("../server/native/index");
const fan = (await import(
  path.join(sandbox, "server/fan-control/index.ts")
)) as typeof import("../server/fan-control/index");
const protocol = (await import(
  path.join(sandbox, "server/websocket/index.ts")
)) as typeof import("../server/websocket/index");
const { state } = (await import(
  path.join(sandbox, "server/state/index.ts")
)) as typeof import("../server/state/index");
const { createHttpHandler } = (await import(
  path.join(sandbox, "server/http.ts")
)) as typeof import("../server/http");
const { listenOnLoopback } = (await import(
  path.join(sandbox, "server/listeners.ts")
)) as typeof import("../server/listeners");

let shuttingDown = false;
await native.initNativeServices();
const servers = await listenOnLoopback({
  port: 5522,
  fetch: createHttpHandler({
    frontendDir: assets,
    isDev: false,
    isShuttingDown: () => shuttingDown,
  }),
  websocket: protocol.websocketHandlers,
});
protocol.setServers(servers);
report({
  event: "ready",
  families: servers.map((server) => server.hostname),
  state,
});

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  // Admission closes before releasing an already-admitted fake operation.
  fan.startFanControlShutdown();
  const drained = protocol.startWebSocketShutdown();
  protocol.setServers([]);
  releaseWrite?.();
  await Promise.all(servers.map((server) => server.stop(true)));
  await drained;
  await fan.awaitFanControlIdle();
  await native.drainNativeCalls();
  await fan.restoreAutoFanControl();
  await native.cleanupNativeServices();
  report({ event: "stopped", calls });
}

const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  void (async () => {
    const command = JSON.parse(line) as { id: number; op: string };
    switch (command.op) {
      case "hold-next-write":
        holdNextWrite = true;
        break;
      case "release-write":
        releaseWrite?.();
        break;
      case "fail-cpu":
        cpuFailed = true;
        break;
      case "fail-wmi": {
        const error = Object.assign(
          new Error("Deterministic permanent WMI failure"),
          { restartRequired: true },
        );
        failureListener?.("wmi", error);
        break;
      }
      case "inspect":
        break;
      case "stop":
        await shutdown();
        input.close();
        process.stdin.destroy();
        break;
      default:
        throw new Error(`Unknown fixture command: ${command.op}`);
    }
    report({ event: "reply", id: command.id, state, calls });
  })().catch((error: unknown) => {
    report({ event: "fatal", error: String(error) });
    process.exitCode = 1;
  });
});
input.on("close", () => {
  void shutdown();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown().finally(() => process.exit());
  });
}
