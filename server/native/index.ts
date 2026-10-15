import type { Args, NativeResult } from "../../common/types";
import {
  cleanupFanControlIntervals,
  fanControl,
  restoreAutoFanControl,
} from "../fan-control/index";
import { state } from "../state/index";
import { publishState } from "../websocket/index";

type ACPIModule = {
  getCall: (
    methodId: string,
    methodName: string,
    args?: Args,
  ) => Promise<NativeResult>;
  isAvailable?: () => Promise<boolean>;
  setCall: (methodId: string, methodName: string, args: Args) => Promise<void>;
  wmiInit: () => Promise<void>;
  wmiCleanup: () => void | Promise<void>;
  onHardwareFailure?: (
    listener: (channel: "wmi" | "cpuoc", error: Error) => void,
  ) => () => unknown;
};

type CPUOCModule = {
  cpuocCleanup?: () => void | Promise<void>;
  tuneInit: () => Promise<void>;
  tune: (pl1: number, pl2: number) => Promise<void>;
};

const isLinux = process.platform === "linux";
if (!isLinux && process.platform !== "win32") {
  throw new Error(`Unsupported hardware platform: ${process.platform}`);
}

const acpiModule: ACPIModule = await (isLinux
  ? import("./linux/acpi")
  : import("./windows/hardware"));

const cpuocModule: CPUOCModule = await (isLinux
  ? import("./linux/cpuoc")
  : import("./windows/hardware"));

const {
  getCall: getCallNative,
  wmiInit,
  setCall: setCallNative,
  wmiCleanup,
} = acpiModule;
const { cpuocCleanup, tuneInit, tune: tuneNative } = cpuocModule;

function reportNativeFailure(channel: "wmi" | "cpuoc", error: Error) {
  if (channel === "wmi") {
    state.isFanControlAvailable = false;
    state.isGpuBoostAvailable = false;
    cleanupFanControlIntervals();
  } else {
    state.isCpuTuningAvailable = false;
  }
  state.restartRequired = true;
  console.error("[Native]", error.message);
  publishState();
}

acpiModule.onHardwareFailure?.(reportNativeFailure);

let acpiCallQueue: Promise<void> = Promise.resolve();
let cpuCallQueue: Promise<void> = Promise.resolve();
let servicesClosed = false;

function enqueueAcpiCall<T>(operation: () => Promise<T>) {
  if (servicesClosed)
    return Promise.reject(new Error("Native services are closed"));
  // Linux shares /proc/acpi/call; Windows COM and DLL state has thread affinity.
  // Keep fan operations ordered; independent CPU work uses its own queue.
  const result = acpiCallQueue.then(operation, operation);
  acpiCallQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function getCall(methodId: string, methodName: string, args?: Args) {
  const input = args ? { ...args } : undefined;
  return enqueueAcpiCall(() => getCallNative(methodId, methodName, input));
}

function setCall(methodId: string, methodName: string, args: Args) {
  const input = { ...args };
  return enqueueAcpiCall(() => setCallNative(methodId, methodName, input));
}

function tune(pl1 = state.pl1, pl2 = state.pl2) {
  return enqueueCpuCall(() => tuneNative(pl1, pl2)).catch((error: unknown) => {
    // Windows workers report permanent failures immediately; Linux RAPL
    // reports an unverifiable rollback through the same error contract.
    if (
      error instanceof Error &&
      "restartRequired" in error &&
      error.restartRequired === true &&
      (state.isCpuTuningAvailable !== false || !state.restartRequired)
    )
      reportNativeFailure("cpuoc", error);
    throw error;
  });
}

function enqueueCpuCall<T>(operation: () => Promise<T>) {
  if (servicesClosed)
    return Promise.reject(new Error("Native services are closed"));
  const run = () => {
    // Shutdown may begin while an earlier optional tuning operation is still
    // running. Do not start another queued hardware mutation afterwards.
    if (servicesClosed) throw new Error("Native services are closed");
    return operation();
  };
  const result = cpuCallQueue.then(run, run);
  cpuCallQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function drainNativeCalls() {
  // Optional CPU tuning must never delay the handoff of fan control to BIOS.
  // CPU cleanup cancels parent requests and leaves its Native AOT worker rooted.
  return acpiCallQueue;
}

// When these services are experiencing problems, it might lead to freezing that prevents logs from being written.
async function logWithFlush(message: string) {
  console.log(message);
  await Bun.sleep(0);
}

async function initNativeServices(shouldStop = () => false) {
  if (shouldStop() || servicesClosed) return;
  state.isFanControlAvailable = false;
  state.isCpuTuningAvailable = false;
  state.isGpuBoostAvailable = false;
  let backendAvailable = false;

  if (typeof acpiModule.isAvailable === "function") {
    try {
      state.isFanControlAvailable = await acpiModule.isAvailable();
      backendAvailable = state.isFanControlAvailable;
      if (shouldStop()) return;
      if (!state.isFanControlAvailable) {
        console.warn("[Native] Fan control backend is not available.");
      }
    } catch (e) {
      console.warn(
        "[Native] Fan control backend availability check failed.",
        e,
      );
      state.isFanControlAvailable = false;
    }
  } else if (!isLinux) {
    try {
      await logWithFlush(
        "[Native] Initializing WMI... (If stuck here, there might be a temporary problem with WMI that requires a reboot.)",
      );
      if (shouldStop()) return;
      // The Windows worker owns the timeout. A Promise timeout on the JS
      // thread cannot interrupt a synchronous FFI call on that same thread.
      await enqueueAcpiCall(wmiInit);
      if (shouldStop()) return;
      state.isFanControlAvailable = true;
      backendAvailable = true;
    } catch (e) {
      console.warn(
        "[Native] WMI initialization failed. Fan control may be unavailable.",
        e,
      );
      state.isFanControlAvailable = false;
    }
  } else {
    state.isFanControlAvailable = true;
    backendAvailable = true;
  }

  if (shouldStop()) return;
  if (state.isFanControlAvailable) {
    console.log("[FanControl] Starting fan control monitoring...");
    try {
      await fanControl();
    } catch (error) {
      state.isFanControlAvailable = false;
      console.warn("[FanControl] Initialization failed:", error);
      if (shouldStop()) return;
      try {
        await restoreAutoFanControl();
      } catch (restoreError) {
        // A partial setup may already have disabled BIOS control. Without a
        // confirmed handoff, startup must fail so the server's shutdown path
        // retries restoration instead of leaving an unmonitored manual mode.
        throw new AggregateError(
          [error, restoreError],
          "Fan control initialization failed and BIOS fan control could not be restored",
          { cause: restoreError },
        );
      }
    }
  } else {
    console.warn("[FanControl] Skipping startup: fan control is unavailable.");
  }

  try {
    if (shouldStop()) return;
    await logWithFlush("[Native] Initializing CPU tuning...");
    if (shouldStop()) return;
    await enqueueCpuCall(tuneInit);
    if (shouldStop()) return;
    console.log("[Native] Trying to set initial CPU tuning...");
    await tune();
    if (shouldStop()) return;
    console.log("[Native] CPU tuning initialized successfully.");
    state.isCpuTuningAvailable = true;
  } catch (_) {
    console.warn("[Native] CPU tuning is not available.");
    state.isCpuTuningAvailable = false;
  }

  try {
    if (shouldStop()) return;
    if (!backendAvailable) return;
    console.log("[Native] Setting GPU boost...");
    await setCall("129", "SetAIBoostStatus", { Data: state.gpuBoost ? 1 : 0 });
    if (shouldStop()) return;
    state.isGpuBoostAvailable = true;
  } catch (e) {
    console.warn("[Native] Failed to set GPU boost:", e);
    state.isGpuBoostAvailable = false;
  }

  console.log("[Native] Initialization complete.");
}

async function cleanupNativeServices() {
  servicesClosed = true;
  await drainNativeCalls();
  try {
    await wmiCleanup();
  } finally {
    await cpuocCleanup?.();
  }
}

export {
  cleanupNativeServices,
  drainNativeCalls,
  getCall,
  initNativeServices,
  setCall,
  tune,
};
