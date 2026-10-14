import { CString, dlopen, FFIType } from "bun:ffi";
import path from "node:path";
import { isCompiledBinary } from "../../utils/consts";

const baseDir = isCompiledBinary
  ? path.dirname(process.execPath)
  : import.meta.dirname;
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
let initialization: Promise<void> | undefined;
let poisonedError: Error | undefined;

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

function requireOpen() {
  if (isClosed) {
    throw new Error("CPUOC library is already closed");
  }
  if (poisonedError) throw poisonedError;
}

function nativeFailure(operation: string, result: number): never {
  const error = Object.assign(
    new Error(`CPUOC ${operation} failed: ${getLastError()}`),
    {
      restartRequired: result === -2,
    },
  );
  if (result === -2) poisonedError = error;
  throw error;
}

async function initialize() {
  requireOpen();
  if (initialized) return;
  const exists = await Bun.file(dllPath).exists();
  // Existence checks yield; cleanup must prevent a late DLL load, and an
  // already completed initializer must not initialize the SDK twice.
  requireOpen();
  if (initialized) return;
  if (!exists) {
    throw new Error(
      `CPUOC.dll not found at ${dllPath}. CPU tuning is unavailable.`,
    );
  }
  const current = (lib ??= openCpuocLibrary());
  const result = current.symbols.cpuoc_init();
  if (result !== 0) {
    nativeFailure("init", result);
  }
  initialized = true;
}

export function tuneInit() {
  return (initialization ??= initialize().finally(() => {
    initialization = undefined;
  }));
}

export function tune(pl1: number, pl2: number) {
  return Promise.resolve().then(() => {
    requireOpen();
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
      nativeFailure("tune", result);
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
