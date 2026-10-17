import type { FanTable } from "../../common/types";
import { getCall, setCall } from "../native/index";
import { state } from "../state/index";
import { publishActivity } from "../websocket/index";

export const WAIT_RAMP_DOWN_CYCLES = 30;
export const WAIT_RAMP_UP_CYCLES = 1;
export const CYCLE_DURATION = 2_000;
const TEMP_POLL_INTERVAL = 500;
export const SENSOR_READ_TIMEOUT = 5_000;
const FIXED_MODE_SAMPLES_PER_CYCLE = 1;

let autoFanInterval: ReturnType<typeof setInterval> | null = null;
let reinitInterval: ReturnType<typeof setInterval> | null = null;
let fanControlRunId = 0;
let isFanControlShuttingDown = false;
// Whether a collection cycle is currently in flight. Module-scoped and
// shared across all runs so restarts can never overlap collections. Each
// consumer read has a deadline; native channel ownership can outlive it.
let isCycleInFlight = false;
// A consumer timeout cannot cancel an ACPI operation. Keep its real lifetime
// separate from the collection's timeout, including across controller runs.
let sensorReadInFlight: ReturnType<typeof getCall> | null = null;
let fanWriteQueue: Promise<void> = Promise.resolve();
let appliedFanPercentage: number | null = null;
let manualWriteVersion = 0;
let pendingManualWrites = 0;
let requiresBiosRestore = false;

export function isFanControlRestoreRequired(): boolean {
  return requiresBiosRestore;
}

export function awaitFanControlIdle(): Promise<void> {
  return fanWriteQueue;
}

function enqueueFanWrite(operation: () => Promise<void>): Promise<void> {
  const result = fanWriteQueue.then(async () => {
    if (isFanControlShuttingDown) {
      throw new Error("Fan control is shutting down");
    }
    await operation();
  });
  fanWriteQueue = result.catch(() => undefined);
  return result;
}

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

async function applyFixedFanSpeed(speed: number) {
  if (isFanControlShuttingDown) {
    throw new Error("Fan control is shutting down");
  }
  try {
    await setCall("0x6b", "SetFixedFanSpeed", { Data: speed });
  } catch (error) {
    throw new Error(`SetFixedFanSpeed failed: ${String(error)}`, {
      cause: error,
    });
  }

  if (isFanControlShuttingDown) {
    throw new Error("Fan control is shutting down");
  }
  try {
    await setCall("0x47", "SetGPUFanDuty", { Data: speed });
  } catch (error) {
    throw new Error(`SetGPUFanDuty failed: ${String(error)}`, { cause: error });
  }
}

export async function applyFixedFan(percent: number) {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new Error("Fan percentage must be from 0 to 100");
  }
  manualWriteVersion++;
  pendingManualWrites++;
  try {
    await writeFanPercentage(percent);
  } finally {
    pendingManualWrites--;
  }
}

function writeFanPercentage(percent: number, expectedVersion?: number) {
  return enqueueFanWrite(async () => {
    if (
      expectedVersion !== undefined &&
      (expectedVersion !== manualWriteVersion || pendingManualWrites > 0)
    )
      return;
    try {
      await applyFixedFanSpeed(fanPercentToSpeed(percent));
      appliedFanPercentage = percent;
    } catch (error) {
      // One of the two fan writes may have succeeded. Never label the old
      // or requested percentage as confirmed while their state is unknown.
      appliedFanPercentage = null;
      throw error;
    }
  });
}

// Both CPU and GPU fan are set to the same speed
// due to the shared heat pipes.
export function setFixedFan(percent: number) {
  void applyFixedFan(percent).catch((error) =>
    console.warn("[FanControl] Failed to apply fixed fan speed:", error),
  );
}

// Inverse of initFanControl() — must be updated if initFanControl changes.
export async function restoreAutoFanControl() {
  await fanWriteQueue;
  const results = await Promise.allSettled([
    setCall("0x6a", "SetFixedFanStatus", { Data: 0 }),
    setCall("0x71", "SetAutoFanStatus", { Data: 1 }),
  ]);
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((result) => result.reason),
      "Failed to restore BIOS fan control",
    );
  }
  requiresBiosRestore = false;
}

type SensorRead = number | "stale" | "failed";

type TempCollection =
  | { status: "collected"; avgCPUTemp: number; avgGPUTemp: number }
  | { status: "failed" }
  | { status: "stale" };

// Checks staleness before every ACPI read: a cancelled run must stop issuing
// calls. An already-pending read cannot be aborted from JS, so it is bounded
// by a timeout instead. This bounds collection work, while a held native
// operation still blocks new reads until the transport actually settles.
async function readSensor(
  runId: number,
  methodId: string,
  methodName: string,
): Promise<SensorRead> {
  if (isFanControlShuttingDown || runId !== fanControlRunId) {
    return "stale";
  }

  try {
    const read = getCall(methodId, methodName);
    sensorReadInFlight = read;
    const release = () => {
      if (sensorReadInFlight === read) sensorReadInFlight = null;
    };
    // Both handlers remain attached after a timeout; a late native rejection
    // must neither become unhandled nor permit another queued sensor request.
    void read.then(release, release);
    const result = await withReadTimeout(read);
    if (typeof result !== "number" || !Number.isFinite(result) || result < 0)
      return "failed";
    return result;
  } catch (error) {
    console.warn(`[FanControl] ${methodName} failed:`, error);
    return "failed";
  }
}

function withReadTimeout(promise: ReturnType<typeof getCall>) {
  return new Promise<Awaited<ReturnType<typeof getCall>>>((resolve, reject) => {
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

function initFanControl(runId: number) {
  return enqueueFanWrite(async () => {
    requiresBiosRestore = true;
    for (const [methodId, methodName, data] of [
      ["0x58", "SetSuperQuiet", 0],
      ["0x71", "SetAutoFanStatus", 0],
      ["0x67", "SetStepFanStatus", 0],
      ["0x6a", "SetFixedFanStatus", 1],
    ] as const) {
      if (isFanControlShuttingDown || runId !== fanControlRunId) return;
      await setCall(methodId, methodName, { Data: data });
    }
  });
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
  const isFixedMode = state.doFixedSpeed;
  const samplesPerCycle = isFixedMode
    ? FIXED_MODE_SAMPLES_PER_CYCLE
    : Math.round((CYCLE_DURATION - TEMP_POLL_INTERVAL) / TEMP_POLL_INTERVAL);
  const sampleInterval = isFixedMode ? CYCLE_DURATION : TEMP_POLL_INTERVAL;

  // Accumulate readings directly instead of allocating temperature arrays.
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
      await Bun.sleep(sampleInterval);
    }
  }

  return {
    status: "collected",
    avgCPUTemp: cpuSum / samplesPerCycle,
    avgGPUTemp: gpuSum / samplesPerCycle,
  };
}

export async function fanControl() {
  if (isFanControlShuttingDown) {
    return;
  }

  cleanupFanControlIntervals();
  const runId = ++fanControlRunId;

  await initFanControl(runId);
  if (isFanControlShuttingDown || runId !== fanControlRunId) return;
  // Before the first valid thermal sample, use the same fail-hot policy as a
  // failed collection. Never replace BIOS control with a minimum blind speed.
  let needsFirstAutomaticTarget = !state.doFixedSpeed;
  let appliedPercentage = state.doFixedSpeed
    ? state.fixedPercentage
    : highestFanTarget();
  await writeFanPercentage(appliedPercentage);
  if (isFanControlShuttingDown || runId !== fanControlRunId) return;

  // On Linux, it happened once that restarting the fan control
  // was necessary. But it's so rare it can't be tested what
  // might cause it.
  // So - enforcing every ~5 minutes that our fixed fan settings
  // are used should prevent that.
  let reinitInFlight = false;
  reinitInterval = setInterval(
    () => {
      if (
        isFanControlShuttingDown ||
        runId !== fanControlRunId ||
        reinitInFlight
      ) {
        return;
      }

      reinitInFlight = true;
      void initFanControl(runId)
        .catch((error: unknown) => {
          console.warn(
            "[FanControl] Failed to reinitialize fan control:",
            error,
          );
        })
        .finally(() => {
          reinitInFlight = false;
        });
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

  let currRampDownCycle = 1;
  let currRampUpCycle = 1;
  let previousManualWriteVersion = manualWriteVersion;
  let prevCPUFanTable = state.cpuFanTable;
  let prevGPUFanTable = state.gpuFanTable;
  // Last successfully collected averages of this run — published instead of
  // fabricated sentinel values when a later collection fails.
  let lastAverages: { avgCPUTemp: number; avgGPUTemp: number } | null = null;
  autoFanInterval = setInterval(async () => {
    // Shutdown and restart transitions are serviced even while a collection
    // cycle is in flight — a stalled read must not hide them behind the
    // cycle guard. Fixed mode is a served mode (see below), not a teardown.
    if (isFanControlShuttingDown || runId !== fanControlRunId) {
      return;
    }

    // Skip this tick while any collection cycle is still in flight,
    // including one from a previous run — collections must never overlap.
    // A leftover cycle aborts at its next sensor read. A timed-out native
    // operation still owns the channel, so do not add reads behind it.
    if (isCycleInFlight || sensorReadInFlight !== null) {
      return;
    }
    if (pendingManualWrites > 0) return;
    const cycleWriteVersion = manualWriteVersion;

    isCycleInFlight = true;
    let cycleSensorFailure = false;
    let cycleTarget = state.doFixedSpeed
      ? state.fixedPercentage
      : highestFanTarget();
    try {
      // Collect average temperature throughout CYCLE_DURATION.
      // In fixed mode we intentionally use a single sample per cycle to keep
      // telemetry available without paying the full auto-control polling cost.
      const collection = await collectAverageTemps(runId);
      if (
        collection.status === "stale" ||
        isFanControlShuttingDown ||
        runId !== fanControlRunId ||
        pendingManualWrites > 0 ||
        cycleWriteVersion !== manualWriteVersion
      ) {
        return;
      }

      if (cycleWriteVersion !== previousManualWriteVersion) {
        // A fixed-mode command can complete and return to Auto between
        // samples. Retire cooling history even if no cycle saw that mode;
        // the confirmed output below is the new ramp baseline. Failed or
        // partial manual writes also invalidate the previous history, while
        // the unconfirmed-output path still recovers the current target.
        previousManualWriteVersion = cycleWriteVersion;
        currRampDownCycle = 1;
        currRampUpCycle = 1;
        needsFirstAutomaticTarget = false;
      }

      if (collection.status === "failed") {
        cycleSensorFailure = true;
        if (state.doFixedSpeed) {
          needsFirstAutomaticTarget = false;
          currRampDownCycle = 1;
          currRampUpCycle = 1;
          prevCPUFanTable = state.cpuFanTable;
          prevGPUFanTable = state.gpuFanTable;
          // A failed/partial write can leave the physical fans inconsistent
          // with the saved fixed target. Recover it even while sensors fail.
          if (appliedFanPercentage !== state.fixedPercentage) {
            await writeFanPercentage(state.fixedPercentage, cycleWriteVersion);
            appliedPercentage = state.fixedPercentage;
          }
          // The user-pinned target stands; telemetry retains the last known
          // measurements instead of inventing new temperatures.
          if (lastAverages) {
            publishActivity({
              appliedSpeed: appliedFanPercentage,
              avgCPUTemp: lastAverages.avgCPUTemp,
              avgGPUTemp: lastAverages.avgGPUTemp,
              target: state.fixedPercentage,
              sensorFailure: true,
            });
          }
          return;
        }

        // A failed read means the thermal state is unknown — fail hot with
        // the highest shared target instead of diluting the failure into
        // the cycle average.
        const target = highestFanTarget();
        await writeFanPercentage(target, cycleWriteVersion);
        appliedPercentage = target;
        currRampDownCycle = 1;
        currRampUpCycle = 1;
        // Temps are telemetry, not control input: report the last real
        // measurements (or nothing at all) instead of a sentinel that
        // clients would display as a measured temperature. The
        // sensorFailure flag lets 1.1 clients render an explicit sensor
        // error state instead of trusting the last-known numbers.
        if (lastAverages) {
          publishActivity({
            appliedSpeed: appliedFanPercentage,
            avgCPUTemp: lastAverages.avgCPUTemp,
            avgGPUTemp: lastAverages.avgGPUTemp,
            target,
            sensorFailure: true,
          });
        }
        return;
      }

      const { avgCPUTemp, avgGPUTemp } = collection;
      lastAverages = { avgCPUTemp, avgGPUTemp };

      if (state.doFixedSpeed) {
        needsFirstAutomaticTarget = false;
        if (appliedFanPercentage !== state.fixedPercentage) {
          await writeFanPercentage(state.fixedPercentage, cycleWriteVersion);
          appliedPercentage = state.fixedPercentage;
        }

        currRampDownCycle = 1;
        currRampUpCycle = 1;
        prevCPUFanTable = state.cpuFanTable;
        prevGPUFanTable = state.gpuFanTable;

        publishActivity({
          appliedSpeed: appliedFanPercentage,
          avgCPUTemp,
          avgGPUTemp,
          target: state.fixedPercentage,
          sensorFailure: false,
        });
        return;
      }

      const highestMatchCPU = findHighestMatch(avgCPUTemp, state.cpuFanTable);
      const highestMatchGPU = findHighestMatch(avgGPUTemp, state.gpuFanTable);

      // Target speed is whichever one of the two is higher because
      // of the mostly shared heat pipes.
      const target = Math.max(highestMatchCPU[1], highestMatchGPU[1]);
      cycleTarget = target;
      let gradientTarget;

      // A direct fixed-mode request may have changed the confirmed speed
      // between cycles. Start curve ramping from that actual applied speed.
      appliedPercentage = appliedFanPercentage ?? appliedPercentage;
      if (
        needsFirstAutomaticTarget ||
        prevCPUFanTable !== state.cpuFanTable ||
        prevGPUFanTable !== state.gpuFanTable ||
        appliedFanPercentage === null
      ) {
        // Apply the new curve at the current temperature. Resetting to its
        // first row can abruptly slow fans while the machine is hot.
        await writeFanPercentage(target, cycleWriteVersion);
        needsFirstAutomaticTarget = false;
        appliedPercentage = target;
        prevCPUFanTable = state.cpuFanTable;
        prevGPUFanTable = state.gpuFanTable;
        currRampDownCycle = 1;
        currRampUpCycle = 1;
      } else if (appliedPercentage < target) {
        currRampDownCycle = 1;
        if (currRampUpCycle === WAIT_RAMP_UP_CYCLES) {
          gradientTarget = getGradientTarget(appliedPercentage, target);
          await writeFanPercentage(gradientTarget, cycleWriteVersion);

          currRampDownCycle = 1;
          currRampUpCycle = 1;
          appliedPercentage = gradientTarget;
        } else {
          currRampUpCycle++;
        }
      } else if (target < appliedPercentage) {
        currRampUpCycle = 1;
        // Make fan behavior less erratic by waiting a few cycles until we
        // ramp down.
        if (currRampDownCycle === WAIT_RAMP_DOWN_CYCLES) {
          gradientTarget = getGradientTarget(appliedPercentage, target);
          await writeFanPercentage(gradientTarget, cycleWriteVersion);

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
        appliedSpeed: appliedFanPercentage,
        avgCPUTemp,
        avgGPUTemp,
        target,
        sensorFailure: false,
      });
    } catch (error) {
      console.warn("[FanControl] Failed to apply fan target:", error);
      if (lastAverages) {
        publishActivity({
          appliedSpeed: null,
          ...lastAverages,
          target: cycleTarget,
          sensorFailure: cycleSensorFailure,
        });
      }
    } finally {
      isCycleInFlight = false;
    }
  }, CYCLE_DURATION);
}
