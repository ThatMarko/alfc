import type { FanTable } from "../../common/types";
import { getCall, setCall } from "../native/index";
import { state } from "../state/index";
import { publishActivity } from "../websocket/index";

export const WAIT_RAMP_DOWN_CYCLES = 10;
export const WAIT_RAMP_UP_CYCLES = 3;
export const CYCLE_DURATION = 1000;
const TEMP_POLL_INTERVAL = 200;
const FIXED_MODE_SAMPLES_PER_CYCLE = 1;

let autoFanInterval: ReturnType<typeof setInterval> | null = null;
let reinitInterval: ReturnType<typeof setInterval> | null = null;
let fanControlRunId = 0;
let isFanControlShuttingDown = false;

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
  try {
    await setCall("0x6b", "SetFixedFanSpeed", { Data: speed });
  } catch (error) {
    throw new Error(`SetFixedFanSpeed failed: ${String(error)}`);
  }

  try {
    await setCall("0x47", "SetGPUFanDuty", { Data: speed });
  } catch (error) {
    throw new Error(`SetGPUFanDuty failed: ${String(error)}`);
  }
}

export async function applyFixedFan(percent: number) {
  if (isFanControlShuttingDown) {
    return;
  }

  await applyFixedFanSpeed(fanPercentToSpeed(percent));
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
  await setCall("0x6a", "SetFixedFanStatus", { Data: 0 });
  await setCall("0x71", "SetAutoFanStatus", { Data: 1 });
}

async function getCallInt(methodId: string, methodName: string) {
  const result = await getCall(methodId, methodName);
  return isNaN(result) ? 200 : result;
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

async function collectAverageTemps(runId: number) {
  const CPUTemps: number[] = [];
  const GPUTemps: number[] = [];
  const isFixedMode = state.doFixedSpeed;
  const samplesPerCycle = isFixedMode
    ? FIXED_MODE_SAMPLES_PER_CYCLE
    : Math.round((CYCLE_DURATION - TEMP_POLL_INTERVAL) / TEMP_POLL_INTERVAL);
  const sampleInterval = isFixedMode ? CYCLE_DURATION : TEMP_POLL_INTERVAL;

  while (CPUTemps.length < samplesPerCycle) {
    if (isFanControlShuttingDown || runId !== fanControlRunId) {
      return null;
    }

    const currCPUTemp = await getCallInt("0xe1", "getCpuTemp");
    const currGPUTemp1 = await getCallInt("0xe2", "getGpuTemp1");
    const currGPUTemp2 = await getCallInt("0xe3", "getGpuTemp2");
    const currGPUTemp = Math.max(currGPUTemp1, currGPUTemp2);

    CPUTemps.push(currCPUTemp);
    GPUTemps.push(currGPUTemp);

    if (CPUTemps.length < samplesPerCycle) {
      await Bun.sleep(sampleInterval);
    }
  }

  return {
    avgCPUTemp: CPUTemps.reduce((sum, temp) => sum + temp, 0) / CPUTemps.length,
    avgGPUTemp: GPUTemps.reduce((sum, temp) => sum + temp, 0) / GPUTemps.length,
  };
}

export function fanControl() {
  if (isFanControlShuttingDown) {
    return;
  }

  cleanupFanControlIntervals();
  const runId = ++fanControlRunId;

  initFanControl();
  let appliedPercentage = state.doFixedSpeed
    ? state.fixedPercentage
    : resetFanSpeed();

  if (state.doFixedSpeed) {
    setFixedFan(state.fixedPercentage);
  }

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

  let currRampDownCycle = 1;
  let currRampUpCycle = 1;
  let prevCPUFanTable = state.cpuFanTable;
  let prevGPUFanTable = state.gpuFanTable;
  autoFanInterval = setInterval(async () => {
    if (isFanControlShuttingDown || runId !== fanControlRunId) {
      cleanupFanControlIntervals();
      return;
    }

    // Collect average temperature throughout CYCLE_DURATION.
    // In fixed mode we intentionally use a single sample per cycle to keep
    // telemetry available without paying the full auto-control polling cost.
    const averages = await collectAverageTemps(runId);
    if (!averages || isFanControlShuttingDown || runId !== fanControlRunId) {
      return;
    }

    const { avgCPUTemp, avgGPUTemp } = averages;

    if (state.doFixedSpeed) {
      if (appliedPercentage !== state.fixedPercentage) {
        setFixedFan(state.fixedPercentage);
        appliedPercentage = state.fixedPercentage;
      }

      currRampDownCycle = 1;
      currRampUpCycle = 1;
      prevCPUFanTable = state.cpuFanTable;
      prevGPUFanTable = state.gpuFanTable;

      publishActivity({
        appliedSpeed: appliedPercentage,
        avgCPUTemp,
        avgGPUTemp,
        target: state.fixedPercentage,
      });
      return;
    }

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
        gradientTarget = getGradientTarget(appliedPercentage, target);
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
      appliedSpeed: appliedPercentage,
      avgCPUTemp,
      avgGPUTemp,
      target,
    });
  }, CYCLE_DURATION);
}
