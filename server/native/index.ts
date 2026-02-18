import type { Args } from "../../common/types";
import { fanControl } from "../fan-control/index";
import { state } from "../state/index";

type ACPIModule = {
  getCall: (
    methodId: string,
    methodName: string,
    args?: Args,
  ) => Promise<number>;
  setCall: (methodId: string, methodName: string, args: Args) => Promise<void>;
  wmiInit: () => Promise<void>;
};

type CPUOCModule = {
  tuneInit: () => Promise<void>;
  tune: (pl1: number, pl2: number) => Promise<void>;
};

const isLinux = process.platform === "linux";

const acpiModule: ACPIModule = await (isLinux
  ? import("./linux/acpi")
  : import("./windows/acpi"));

const cpuocModule: CPUOCModule = await (isLinux
  ? import("./linux/cpuoc")
  : import("./windows/cpuoc"));

const { getCall, wmiInit, setCall } = acpiModule;
const { tuneInit, tune: tuneNative } = cpuocModule;

function tune() {
  return tuneNative(state.pl1, state.pl2);
}

function promiseWithTimeout<T>(promise: Promise<T>, timeout = 1000 * 5) {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Timeout")), timeout);
    }),
  ]);
}

// When these services are experiencing problems, it might lead to freezing that prevents logs from being written.
async function logWithFlush(message: string) {
  console.log(message);
  await Bun.sleep(0);
}

async function initNativeServices() {
  if (!isLinux) {
    try {
      await logWithFlush(
        "[Native] Initializing WMI... (If stuck here, there might be a temporary problem with WMI that requires a reboot.)",
      );
      await promiseWithTimeout(wmiInit());
      state.isFanControlAvailable = true;
    } catch (e) {
      console.warn(
        "[Native] WMI initialization failed. Fan control may be unavailable.",
        e,
      );
      state.isFanControlAvailable = false;
    }

    try {
      await logWithFlush("[Native] Initializing CPU tuning...");
      await promiseWithTimeout(tuneInit());
    } catch (e) {
      console.warn("[Native] CPU tuning initialization failed.", e);
    }
  }

  if (state.isFanControlAvailable !== false) {
    console.log("[FanControl] Starting fan control monitoring...");
    fanControl();
  } else {
    console.warn(
      "[FanControl] Skipping startup due to WMI initialization failure.",
    );
  }

  try {
    console.log("[Native] Trying to set initial CPU tuning...");
    await tune();
    console.log("[Native] CPU tuning initialized successfully.");
    state.isCpuTuningAvailable = true;
  } catch (_) {
    console.warn("[Native] CPU tuning is not available.");
    state.isCpuTuningAvailable = false;
  }

  try {
    console.log("[Native] Setting GPU boost...");
    await setCall("129", "SetAIBoostStatus", { Data: state.gpuBoost ? 1 : 0 });
    state.isGpuBoostAvailable = true;
  } catch (e) {
    console.warn("[Native] Failed to set GPU boost:", e);
    state.isGpuBoostAvailable = false;
  }

  console.log(
    "[Server] Fan control is up and running, current config was applied.",
  );
}

export { getCall, initNativeServices, setCall, tune };
