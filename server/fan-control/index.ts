import type { FanTable } from "../../common/types";
import { getCall, setCall } from "../native/index";
import { state } from "../state/index";
import { publishActivity } from "../websocket/index";

export const WAIT_RAMP_DOWN_CYCLES = 30;
export const WAIT_RAMP_UP_CYCLES = 1;
export const CYCLE_DURATION = 2_000;
const TEMP_POLL_INTERVAL = 500;
export const SENSOR_READ_TIMEOUT = 5_000;

let autoFanInterval: ReturnType<typeof setInterval> | null = null;
let reinitInterval: ReturnType<typeof setInterval> | null = null;
let fanControlRunId = 0;
let isFanControlShuttingDown = false;
// Whether a collection cycle is currently in flight. Module-scoped and
// shared across ALL runs so restarts can never overlap collections; a
// wedged native read cannot hold it forever because every read times out.
let isCycleInFlight = false;

export function cleanupFanControlIntervals() {
  if (autoFanInterval) {
    clearInterval(autoFanInterval);
    autoFanInterval = null;
  }

  if (reinitInterval) {
    clearInterval(reinitInterval);
    reinitInterval = null;
  }
}

export function startFanControlShutdown() {
  if (isFanControlShuttingDown) {
    return;
  }

  isFanControlShuttingDown = true;
  fanControlRunId++;
  cleanupFanControlIntervals();
}

export function fanPercentToSpeed(percent: number) {
  return Math.ceil((percent / 100.0) * 229);
}

// Both CPU and GPU fan are set to the same speed
// due to the shared heat pipes.
export function setFixedFan(percent: number) {
  if (isFanControlShuttingDown) {
    return;
  }

  const speed = fanPercentToSpeed(percent);

  // SetFixedFanSpeed
  setCall("0x6b", "SetFixedFanSpeed", { Data: speed }).catch((e) =>
    console.warn("[FanControl] SetFixedFanSpeed failed:", e),
  );
  // SetGPUFanDuty
  setCall("0x47", "SetGPUFanDuty", { Data: speed }).catch((e) =>
    console.warn("[FanControl] SetGPUFanDuty failed:", e),
  );
}

// Inverse of initFanControl() — must be updated if initFanControl changes.
export async function restoreAutoFanControl() {
  await setCall("0x6a", "SetFixedFanStatus", { Data: 0 });
  await setCall("0x71", "SetAutoFanStatus", { Data: 1 });
}

type SensorRead = number | "stale" | "failed";

type TempCollection =
  | { status: "collected"; avgCPUTemp: number; avgGPUTemp: number }
  | { status: "failed" }
  | { status: "stale" };

// Checks staleness before every ACPI read: a cancelled run must stop issuing
// calls. An already-pending read cannot be aborted from JS, so it is bounded
// by a timeout instead — that also bounds how long a wedged read can hold
// the shared cycle lock.
async function readSensor(
  runId: number,
  methodId: string,
  methodName: string,
): Promise<SensorRead> {
  if (
    isFanControlShuttingDown ||
    runId !== fanControlRunId ||
    state.doFixedSpeed
  ) {
    return "stale";
  }

  try {
    const result = await withReadTimeout(getCall(methodId, methodName));
    if (isNaN(result)) return "failed";
    return result;
  } catch (error) {
    console.warn(`[FanControl] ${methodName} failed:`, error);
    return "failed";
  }
}

function withReadTimeout(promise: Promise<number>) {
  return new Promise<number>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out after ${SENSOR_READ_TIMEOUT}ms`)),
      SENSOR_READ_TIMEOUT,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function initFanControl() {
  setCall("0x58", "SetSuperQuiet", { Data: 0 }).catch((e) =>
    console.warn("[FanControl] SetSuperQuiet failed:", e),
  );
  setCall("0x71", "SetAutoFanStatus", { Data: 0 }).catch((e) =>
    console.warn("[FanControl] SetAutoFanStatus failed:", e),
  );
  setCall("0x67", "SetStepFanStatus", { Data: 0 }).catch((e) =>
    console.warn("[FanControl] SetStepFanStatus failed:", e),
  );
  setCall("0x6a", "SetFixedFanStatus", { Data: 1 }).catch((e) =>
    console.warn("[FanControl] SetFixedFanStatus failed:", e),
  );
}

function resetFanSpeed() {
  const firstEntry = state.cpuFanTable[0];
  const speed = firstEntry ? firstEntry[1] : 0;
  setFixedFan(speed);
  return speed;
}

// Highest percentage anywhere in both tables — the fail-hot target when the
// thermal state is unknown. Speeds are not guaranteed to be monotonic (the
// last row is not necessarily the maximum), so every entry is considered.
function highestFanTarget() {
  let max = 0;
  for (const entry of state.cpuFanTable) {
    max = Math.max(max, entry[1]);
  }
  for (const entry of state.gpuFanTable) {
    max = Math.max(max, entry[1]);
  }
  return max;
}

async function collectAverageTemps(runId: number): Promise<TempCollection> {
  const samplesPerCycle = Math.round(
    (CYCLE_DURATION - TEMP_POLL_INTERVAL) / TEMP_POLL_INTERVAL,
  );

  // Running sums instead of array allocations — zero per-cycle heap pressure
  let cpuSum = 0;
  let gpuSum = 0;

  for (let sample = 0; sample < samplesPerCycle; sample++) {
    const cpuTemp = await readSensor(runId, "0xe1", "getCpuTemp");
    if (typeof cpuTemp !== "number") return { status: cpuTemp };

    const gpuTemp1 = await readSensor(runId, "0xe2", "getGpuTemp1");
    if (typeof gpuTemp1 !== "number") return { status: gpuTemp1 };

    const gpuTemp2 = await readSensor(runId, "0xe3", "getGpuTemp2");
    if (typeof gpuTemp2 !== "number") return { status: gpuTemp2 };

    cpuSum += cpuTemp;
    gpuSum += Math.max(gpuTemp1, gpuTemp2);

    if (sample < samplesPerCycle - 1) {
      await Bun.sleep(TEMP_POLL_INTERVAL);
    }
  }

  return {
    status: "collected",
    avgCPUTemp: cpuSum / samplesPerCycle,
    avgGPUTemp: gpuSum / samplesPerCycle,
  };
}

export function fanControl() {
  if (isFanControlShuttingDown) {
    return;
  }

  cleanupFanControlIntervals();
  const runId = ++fanControlRunId;

  initFanControl();
  resetFanSpeed();

  // On Linux, it happened once that restarting the fan control
  // was necessary. But it's so rare it can't be tested what
  // might cause it.
  // So - enforcing every ~5 minutes that our fixed fan settings
  // are used should prevent that.
  reinitInterval = setInterval(
    () => {
      if (isFanControlShuttingDown || runId !== fanControlRunId) {
        return;
      }

      initFanControl();
    },
    1000 * 60 * 5,
  );

  // Find highest entry that isn't larger than provided temp,
  // assuming that fan table entries in profiles are ascending.
  function findHighestMatch(
    temperature: number,
    table: FanTable,
  ): [number, number] {
    let highestMatch: [number, number] = table[0] ?? [0, 0];

    for (const entry of table) {
      if (entry[0] <= temperature) {
        highestMatch = entry;
      } else {
        break;
      }
    }

    return highestMatch;
  }

  function getGradientTarget(
    lastAppliedPercentage: number,
    targetPercentage: number,
  ) {
    let gradientTarget = targetPercentage;

    if (targetPercentage > lastAppliedPercentage) {
      gradientTarget =
        lastAppliedPercentage +
        Math.round((targetPercentage - lastAppliedPercentage) / 2);
    } else if (targetPercentage < lastAppliedPercentage) {
      gradientTarget =
        lastAppliedPercentage -
        Math.round((lastAppliedPercentage - targetPercentage) / 2);
    }

    return Math.abs(targetPercentage - gradientTarget) < 5
      ? targetPercentage
      : gradientTarget;
  }

  let appliedPercentage = -1;
  let currRampDownCycle = 1;
  let currRampUpCycle = 1;
  let prevCPUFanTable = state.cpuFanTable;
  let prevGPUFanTable = state.gpuFanTable;
  // Last successfully collected averages of this run — published instead of
  // fabricated sentinel values when a later collection fails.
  let lastAverages: { avgCPUTemp: number; avgGPUTemp: number } | null = null;
  autoFanInterval = setInterval(async () => {
    // Control-state transitions are serviced even while a collection cycle
    // is in flight — otherwise a stalled read would permanently hide a
    // fixed-speed switch or shutdown behind the cycle guard.
    if (isFanControlShuttingDown || runId !== fanControlRunId) {
      return;
    }

    // Interrupt if switching to fixed fan speed
    if (state.doFixedSpeed) {
      cleanupFanControlIntervals();
      setFixedFan(state.fixedPercentage);
      return;
    }

    // Skip this tick while any collection cycle is still in flight,
    // including one from a previous run — collections must never overlap.
    // A leftover cycle aborts at its next sensor read, and a wedged read
    // times out, so this cannot deadlock a restart.
    if (isCycleInFlight) {
      return;
    }

    isCycleInFlight = true;
    try {
      // Collect average temperature throughout CYCLE_DURATION
      const collection = await collectAverageTemps(runId);
      if (
        collection.status === "stale" ||
        isFanControlShuttingDown ||
        runId !== fanControlRunId ||
        state.doFixedSpeed
      ) {
        return;
      }

      if (collection.status === "failed") {
        // A failed read means the thermal state is unknown — fail hot with
        // the highest shared target instead of diluting the failure into
        // the cycle average.
        const target = highestFanTarget();
        setFixedFan(target);
        appliedPercentage = target;
        currRampDownCycle = 1;
        currRampUpCycle = 1;
        // Temps are telemetry, not control input: report the last real
        // measurements (or nothing at all) instead of a sentinel that
        // clients would display as a measured temperature.
        if (lastAverages) {
          publishActivity({
            appliedSpeed: target,
            avgCPUTemp: lastAverages.avgCPUTemp,
            avgGPUTemp: lastAverages.avgGPUTemp,
            target,
          });
        }
        return;
      }

      const { avgCPUTemp, avgGPUTemp } = collection;
      lastAverages = { avgCPUTemp, avgGPUTemp };

      const highestMatchCPU = findHighestMatch(avgCPUTemp, state.cpuFanTable);
      const highestMatchGPU = findHighestMatch(avgGPUTemp, state.gpuFanTable);

      // Target speed is whichever one of the two is higher because
      // of the mostly shared heat pipes.
      const target = Math.max(highestMatchCPU[1], highestMatchGPU[1]);
      let gradientTarget;

      if (
        prevCPUFanTable !== state.cpuFanTable ||
        prevGPUFanTable !== state.gpuFanTable
      ) {
        // When tables change, do nothing in this cycle but reset fans to the
        // lowest percentage currently in state.
        appliedPercentage = resetFanSpeed();
        prevCPUFanTable = state.cpuFanTable;
        prevGPUFanTable = state.gpuFanTable;
        currRampDownCycle = 1;
        currRampUpCycle = 1;
      } else if (appliedPercentage < target) {
        if (currRampUpCycle === WAIT_RAMP_UP_CYCLES) {
          gradientTarget = getGradientTarget(
            appliedPercentage === -1
              ? (state.cpuFanTable[0]?.[1] ?? 0)
              : appliedPercentage,
            target,
          );
          setFixedFan(gradientTarget);

          currRampDownCycle = 1;
          currRampUpCycle = 1;
          appliedPercentage = gradientTarget;
        } else {
          currRampUpCycle++;
        }
      } else if (target < appliedPercentage) {
        // Make fan behavior less erratic by waiting a few cycles until we
        // ramp down.
        if (currRampDownCycle === WAIT_RAMP_DOWN_CYCLES) {
          gradientTarget = getGradientTarget(appliedPercentage, target);
          setFixedFan(gradientTarget);

          currRampDownCycle = 1;
          currRampUpCycle = 1;
          appliedPercentage = gradientTarget;
        } else {
          currRampDownCycle++;
        }
      } else {
        // Need to reset if e.g. ramp down phase is
        // interrupted by CPU getting hot again or getting cold again.
        currRampDownCycle = 1;
        currRampUpCycle = 1;
      }

      publishActivity({
        appliedSpeed: appliedPercentage === -1 ? null : appliedPercentage,
        avgCPUTemp,
        avgGPUTemp,
        target,
      });
    } finally {
      isCycleInFlight = false;
    }
  }, CYCLE_DURATION);
}
