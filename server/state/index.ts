import { readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import stringifyCompact from "json-stringify-pretty-compact";
import path from "path";
import { isDev } from "../utils/consts.js";
import type { State } from "../../common/types.js";

type PersistedState = Omit<
  State,
  | "protocolVersion"
  | "isCpuTuningAvailable"
  | "isGpuBoostAvailable"
  | "isFanControlAvailable"
>;

const CONFIG_FILE = isDev
  ? path.join(import.meta.dirname, "../../alfc.config.json")
  : path.join(path.dirname(process.execPath), "alfc.config.json");

const TMP_CONFIG_FILE = `${CONFIG_FILE}.tmp`;

const DEFAULT_PERSISTED_STATE: PersistedState = {
  cpuFanTable: [
    [40, 15],
    [83, 50],
    [88, 100],
  ],
  gpuFanTable: [
    [40, 15],
    [78, 50],
    [83, 100],
  ],
  gpuBoost: true,
  pl1: 37,
  pl2: 106,
  doFixedSpeed: false,
  fixedPercentage: 50,
};

function isPersistedFanTable(
  value: unknown,
): value is PersistedState["cpuFanTable"] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === "number" &&
        Number.isFinite(entry[0]) &&
        typeof entry[1] === "number" &&
        Number.isFinite(entry[1]),
    )
  );
}

function isPersistedState(value: unknown): value is PersistedState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const object = value as Record<string, unknown>;

  return (
    isPersistedFanTable(object.cpuFanTable) &&
    isPersistedFanTable(object.gpuFanTable) &&
    typeof object.gpuBoost === "boolean" &&
    typeof object.pl1 === "number" &&
    Number.isFinite(object.pl1) &&
    typeof object.pl2 === "number" &&
    Number.isFinite(object.pl2) &&
    typeof object.doFixedSpeed === "boolean" &&
    typeof object.fixedPercentage === "number" &&
    Number.isFinite(object.fixedPercentage)
  );
}

function loadPersistedState(): PersistedState {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(CONFIG_FILE, { encoding: "utf8" }),
    );

    if (isPersistedState(parsed)) {
      return parsed;
    }

    console.warn(
      "Persisted config has invalid shape. Falling back to defaults.",
    );
  } catch (error) {
    console.warn(
      "Failed to load persisted config. Falling back to defaults: " + error,
    );
  }

  return DEFAULT_PERSISTED_STATE;
}

const persistedState: PersistedState = loadPersistedState();

export const state: State = {
  ...persistedState,
  protocolVersion: "1.0",
};

export async function persistState() {
  if (isDev) {
    return;
  }

  const {
    protocolVersion: _protocolVersion,
    isCpuTuningAvailable: _isCpuTuningAvailable,
    isGpuBoostAvailable: _isGpuBoostAvailable,
    isFanControlAvailable: _isFanControlAvailable,
    ...persistable
  } = state;

  void _protocolVersion;
  void _isCpuTuningAvailable;
  void _isGpuBoostAvailable;
  void _isFanControlAvailable;

  try {
    await writeFile(TMP_CONFIG_FILE, stringifyCompact(persistable), {
      encoding: "utf8",
    });
    await rename(TMP_CONFIG_FILE, CONFIG_FILE);
  } catch (error) {
    console.error("Error trying to persist state: " + error);
  }
}
