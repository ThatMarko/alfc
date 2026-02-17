import { CString, dlopen, FFIType } from "bun:ffi";
import path from "node:path";
import { isDev } from "../../utils/consts";

const baseDir = isDev ? import.meta.dirname : path.dirname(process.execPath);
const dllPath = path.join(baseDir, "CPUOC.dll");

export const isCpuocAvailable = await Bun.file(dllPath).exists();

if (!isCpuocAvailable) {
  console.warn("[CPUOC] CPUOC.dll not found. CPU tuning will be disabled.");
}

const lib = isCpuocAvailable
  ? dlopen(dllPath, {
      cpuoc_init: { args: [], returns: FFIType.i32 },
      cpuoc_tune: { args: [FFIType.f64, FFIType.f64], returns: FFIType.i32 },
      cpuoc_get_last_error: { args: [], returns: FFIType.ptr },
      cpuoc_free_string: { args: [FFIType.ptr], returns: FFIType.void },
    })
  : null;

function getLastError(): string {
  if (!lib) return "CPUOC not available";
  const errorPtr = lib.symbols.cpuoc_get_last_error();
  if (!errorPtr) return "Unknown error";
  const error = new CString(errorPtr);
  lib.symbols.cpuoc_free_string(errorPtr);
  return error.toString();
}

export function tuneInit() {
  if (!lib) return Promise.resolve();
  const result = lib.symbols.cpuoc_init();
  if (result !== 0) {
    throw new Error(`CPUOC init failed: ${getLastError()}`);
  }
  return Promise.resolve();
}

export function tune(pl1: number, pl2: number) {
  if (!lib) return Promise.resolve();
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
