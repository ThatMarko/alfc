import type { FanControlActivity, FanTable, State } from "./types";
import {
  validateFanTable,
  validateFixedPercentage,
  validatePowerLimit,
} from "./validation";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSupportedProtocolVersion(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const version = /^1\.(\d+)$/.exec(value);
  // New clients require 1.1 requestId correlation. Future major-1 minors
  // remain additive; the entire value must be a supported version string.
  return version !== null && version[0] === value && Number(version[1]) >= 1;
}

export function isFanTable(value: unknown): value is FanTable {
  return validateFanTable(value) === null;
}

export function isState(value: unknown): value is State {
  if (!isRecord(value)) return false;

  return (
    isSupportedProtocolVersion(value.protocolVersion) &&
    isFanTable(value.cpuFanTable) &&
    isFanTable(value.gpuFanTable) &&
    typeof value.doFixedSpeed === "boolean" &&
    validateFixedPercentage(value.fixedPercentage) === null &&
    typeof value.gpuBoost === "boolean" &&
    validatePowerLimit(value.pl1) === null &&
    validatePowerLimit(value.pl2) === null &&
    [
      value.isCpuTuningAvailable,
      value.isFanControlAvailable,
      value.isGpuBoostAvailable,
      value.restartRequired,
    ].every((flag) => flag === undefined || typeof flag === "boolean")
  );
}

function isPercentage(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
  );
}

export function isFanControlActivity(
  value: unknown,
): value is FanControlActivity {
  if (!isRecord(value)) return false;

  return (
    (value.appliedSpeed === null || isPercentage(value.appliedSpeed)) &&
    typeof value.avgCPUTemp === "number" &&
    Number.isFinite(value.avgCPUTemp) &&
    typeof value.avgGPUTemp === "number" &&
    Number.isFinite(value.avgGPUTemp) &&
    isPercentage(value.target) &&
    (value.sensorFailure === undefined ||
      typeof value.sensorFailure === "boolean")
  );
}
