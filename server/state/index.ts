import { readFileSync } from "node:fs";
import { chmod, lstat, open, rename, stat } from "node:fs/promises";
import stringifyCompact from "json-stringify-pretty-compact";
import path from "node:path";
import { isCompiledBinary, isDev } from "../utils/consts";
import type { State } from "../../common/types";
import {
  validateFanTable,
  validateFixedPercentage,
  validatePowerLimit,
} from "../../common/validation";

type PersistedState = Omit<
  State,
  | "protocolVersion"
  | "isCpuTuningAvailable"
  | "isGpuBoostAvailable"
  | "isFanControlAvailable"
  | "restartRequired"
>;

const CONFIG_FILE = isCompiledBinary
  ? path.join(path.dirname(process.execPath), "alfc.config.json")
  : path.join(import.meta.dirname, "../../alfc.config.json");

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
  return validateFanTable(value) === null;
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
    validatePowerLimit(object.pl1) === null &&
    validatePowerLimit(object.pl2) === null &&
    typeof object.doFixedSpeed === "boolean" &&
    validateFixedPercentage(object.fixedPercentage) === null
  );
}

function loadPersistedState(): PersistedState {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(CONFIG_FILE, { encoding: "utf8" }),
    );

    if (isPersistedState(parsed)) {
      // Capabilities describe this running machine, never a saved config.
      // Whitelist settings so old or hand-edited files cannot inject them.
      return {
        cpuFanTable: parsed.cpuFanTable,
        gpuFanTable: parsed.gpuFanTable,
        gpuBoost: parsed.gpuBoost,
        pl1: parsed.pl1,
        pl2: parsed.pl2,
        doFixedSpeed: parsed.doFixedSpeed,
        fixedPercentage: parsed.fixedPercentage,
      };
    }

    console.warn("[State] Corrupt or invalid config detected, using defaults.");
  } catch (error) {
    console.warn("[State] Failed to load config, using defaults: " + error);
  }

  return DEFAULT_PERSISTED_STATE;
}

const persistedState: PersistedState = loadPersistedState();

export const state: State = {
  ...persistedState,
  protocolVersion: "1.1",
};

let persistQueue: Promise<void> = Promise.resolve();

function isMissingFile(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export function persistState() {
  if (isDev) {
    return Promise.resolve();
  }

  const {
    protocolVersion: _protocolVersion,
    isCpuTuningAvailable: _isCpuTuningAvailable,
    isGpuBoostAvailable: _isGpuBoostAvailable,
    isFanControlAvailable: _isFanControlAvailable,
    restartRequired: _restartRequired,
    ...persistable
  } = state;
  const serialized = stringifyCompact(persistable);
  const writeSnapshot = async () => {
    let mode = 0o600;
    try {
      mode = (await stat(CONFIG_FILE)).mode & 0o777;
    } catch (error) {
      // Only a missing configuration may use the default. A transient access
      // failure must not silently replace a file with broader permissions.
      if (!isMissingFile(error)) throw error;
    }
    try {
      const staged = await lstat(TMP_CONFIG_FILE);
      if (!staged.isFile()) {
        throw new Error(
          `Configuration staging path must be a regular file: ${TMP_CONFIG_FILE}`,
        );
      }
      // A failed save can leave a read-only staging file. Restore private,
      // writable staging permissions before opening/truncating it; doing
      // this only through the opened descriptor cannot recover that state.
      await chmod(TMP_CONFIG_FILE, 0o600);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
    const file = await open(TMP_CONFIG_FILE, "w", 0o600);
    try {
      // A previous failed save may have left a temp file with another mode.
      // Set it before writing so restricted settings are never staged as 0644
      // merely because the service's umask is 022. Windows supports only its
      // ordinary writable/read-only chmod semantics, not POSIX ACL management.
      await file.chmod(mode);
      await file.writeFile(serialized);
    } finally {
      await file.close();
    }
    await rename(TMP_CONFIG_FILE, CONFIG_FILE);
  };

  const result = persistQueue.then(writeSnapshot);
  persistQueue = result.catch((error: unknown) => {
    console.error("[State] Error trying to persist config:", error);
  });
  return result;
}
