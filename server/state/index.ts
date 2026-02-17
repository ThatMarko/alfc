import { readFileSync } from "node:fs";
import stringifyCompact from "json-stringify-pretty-compact";
import path from "path";
import { isDev } from "../utils/consts.js";
import type { State } from "../../common/types.js";

const CONFIG_FILE = isDev
  ? path.join(import.meta.dirname, "../../alfc.config.json")
  : path.join(path.dirname(process.execPath), "alfc.config.json");

export const state: State = JSON.parse(
  readFileSync(CONFIG_FILE, { encoding: "utf8" }),
);

export async function persistState() {
  if (isDev) {
    return;
  }

  const persistable = { ...state };
  delete persistable.isCpuTuningAvailable;
  delete persistable.isFanControlAvailable;

  try {
    await Bun.write(CONFIG_FILE, stringifyCompact(persistable));
  } catch (error) {
    console.error("Error trying to persist state: " + error);
  }
}
