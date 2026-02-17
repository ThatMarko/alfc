import { CString, dlopen, FFIType } from "bun:ffi";
import path from "path";
import { isDev } from "../../utils/consts.js";

const baseDir = isDev ? import.meta.dirname : path.dirname(process.execPath);

const lib = dlopen(path.join(baseDir, "CPUOC.dll"), {
  cpuoc_init: { args: [], returns: FFIType.i32 },
  cpuoc_tune: { args: [FFIType.f64, FFIType.f64], returns: FFIType.i32 },
  cpuoc_get_last_error: { args: [], returns: FFIType.ptr },
  cpuoc_free_string: { args: [FFIType.ptr], returns: FFIType.void },
});

function getLastError(): string {
  const errorPtr = lib.symbols.cpuoc_get_last_error();
  if (!errorPtr) return "Unknown error";
  const error = new CString(errorPtr);
  lib.symbols.cpuoc_free_string(errorPtr);
  return error.toString();
}

export function tuneInit() {
  const result = lib.symbols.cpuoc_init();
  if (result !== 0) {
    throw new Error(`CPUOC init failed: ${getLastError()}`);
  }
  return Promise.resolve();
}

export function tune(pl1: number, pl2: number) {
  const result = lib.symbols.cpuoc_tune(pl1, pl2);
  if (result !== 0) {
    throw new Error(`CPUOC tune failed: ${getLastError()}`);
  }
  return Promise.resolve();
}

if (import.meta.main) {
  const configPath = path.join(
    import.meta.dirname,
    "../../../alfc.config.json",
  );
  const { pl1, pl2 } = await import(configPath);
  console.log("pl1 " + pl1);
  console.log("pl2 " + pl2);

  await tuneInit();
  await tune(pl1, pl2);
}
