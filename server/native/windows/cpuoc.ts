import { CString, dlopen, FFIType } from "bun:ffi";
import path from "node:path";
import { isDev } from "../../utils/consts";

const baseDir = isDev ? import.meta.dirname : path.dirname(process.execPath);
const dllPath = path.join(baseDir, "CPUOC.dll");

function openCpuocLibrary() {
  return dlopen(dllPath, {
    cpuoc_init: { args: [], returns: FFIType.i32 },
    cpuoc_tune: { args: [FFIType.f64, FFIType.f64], returns: FFIType.i32 },
    cpuoc_get_last_error: { args: [], returns: FFIType.ptr },
    cpuoc_free_string: { args: [FFIType.ptr], returns: FFIType.void },
  });
}

type CpuocLibrary = ReturnType<typeof openCpuocLibrary>;

let lib: CpuocLibrary | null = null;
let isClosed = false;
let initialized = false;

function getLastError(): string {
  if (!lib) return "CPUOC not available";
  const errorPtr = lib.symbols.cpuoc_get_last_error();
  if (!errorPtr) return "Unknown error";
  try {
    return new CString(errorPtr).toString();
  } finally {
    lib.symbols.cpuoc_free_string(errorPtr);
  }
}

export async function tuneInit() {
  if (isClosed) {
    throw new Error("CPUOC library is already closed");
  }
  if (initialized) return;
  if (!(await Bun.file(dllPath).exists())) {
    throw new Error(
      `CPUOC.dll not found at ${dllPath}. CPU tuning is unavailable.`,
    );
  }
  const current = (lib ??= openCpuocLibrary());
  const result = current.symbols.cpuoc_init();
  if (result !== 0) {
    throw new Error(`CPUOC init failed: ${getLastError()}`);
  }
  initialized = true;
}

export function tune(pl1: number, pl2: number) {
  return Promise.resolve().then(() => {
    if (isClosed) {
      throw new Error("CPUOC library is already closed");
    }
    if (!lib || !initialized) {
      throw new Error("CPUOC is not available");
    }
    for (const value of [pl1, pl2]) {
      if (!Number.isInteger(value) || value < 0 || value > 200) {
        throw new RangeError(
          "CPU power limits must be integers between 0 and 200 watts",
        );
      }
    }
    const result = lib.symbols.cpuoc_tune(pl1, pl2);
    if (result !== 0) {
      throw new Error(`CPUOC tune failed: ${getLastError()}`);
    }
  });
}

export function cpuocCleanup() {
  if (isClosed) return;
  // Native AOT explicitly does not support FreeLibrary/dlclose. Retain the
  // library for process lifetime; its owning worker also remains rooted.
  isClosed = true;
  initialized = false;
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
