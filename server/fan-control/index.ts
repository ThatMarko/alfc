import type { FanTable } from "../../common/types";
import { getCall, setCall } from "../native/index";
import { state } from "../state/index";
import { publishActivity } from "../websocket/index";

export const WAIT_RAMP_DOWN_CYCLES = 30;
export const WAIT_RAMP_UP_CYCLES = 1;
export const CYCLE_DURATION = 2_000;
const TEMP_POLL_INTERVAL = 500;

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
  const samplesPerCycle = Math.round(
    (CYCLE_DURATION - TEMP_POLL_INTERVAL) / TEMP_POLL_INTERVAL,
  );

  // Running sums instead of array allocations — zero per-cycle heap pressure
  let cpuSum = 0;
  let gpuSum = 0;

  for (let sample = 0; sample < samplesPerCycle; sample++) {
    if (isFanControlShuttingDown || runId !== fanControlRunId) {
      return null;
    }

    cpuSum += await getCallInt("0xe1", "getCpuTemp");
    const gpuTemp1 = await getCallInt("0xe2", "getGpuTemp1");
    const gpuTemp2 = await getCallInt("0xe3", "getGpuTemp2");
    gpuSum += Math.max(gpuTemp1, gpuTemp2);

    if (sample < samplesPerCycle - 1) {
      await Bun.sleep(TEMP_POLL_INTERVAL);
    }
  }

  return {
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
  autoFanInterval = setInterval(async () => {
    if (isFanControlShuttingDown || runId !== fanControlRunId) {
      cleanupFanControlIntervals();
      return;
    }

    // Interrupt if switching to fixed fan speed
    if (state.doFixedSpeed) {
      cleanupFanControlIntervals();
      setFixedFan(state.fixedPercentage);
      return;
    }

    // Collect average temperature throughout CYCLE_DURATION
    const averages = await collectAverageTemps(runId);
    if (!averages || isFanControlShuttingDown || runId !== fanControlRunId) {
      return;
    }

    const { avgCPUTemp, avgGPUTemp } = averages;

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
  }, CYCLE_DURATION);
}
