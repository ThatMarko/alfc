import { CString, dlopen, FFIType, ptr } from "bun:ffi";
import path from "node:path";
import type { Args } from "../../../common/types";
import { isDev } from "../../utils/consts";

const baseDir = isDev ? import.meta.dirname : path.dirname(process.execPath);
const dllPath = isDev
  ? path.join(baseDir, "wmidll", "WmiDll.dll")
  : path.join(baseDir, "WmiDll.dll");

// Loaded lazily inside wmiInit() so a missing or blocked DLL is a recoverable
// initialization failure (matching cpuoc.ts) instead of a module-evaluation crash.
function openWmiLibrary() {
  return dlopen(dllPath, {
    wmi_init: { args: [], returns: FFIType.i32 },
    wmi_get: {
      args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.ptr],
      returns: FFIType.i32,
    },
    wmi_get_named: {
      args: [
        FFIType.ptr,
        FFIType.ptr,
        FFIType.i32,
        FFIType.ptr,
        FFIType.i32,
        FFIType.ptr,
        FFIType.ptr,
      ],
      returns: FFIType.i32,
    },
    wmi_set: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
    wmi_set_named: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.i32],
      returns: FFIType.i32,
    },
    wmi_cleanup: { args: [], returns: FFIType.void },
    wmi_get_last_error: { args: [], returns: FFIType.ptr },
  });
}

type WmiLibrary = ReturnType<typeof openWmiLibrary>;

let lib: WmiLibrary | null = null;
let isClosed = false;

const resultsBuffer = new Float64Array(16);
const countBuffer = new Int32Array(1);
const resultsPtr = ptr(resultsBuffer);
const countPtr = ptr(countBuffer);

const methodPtrCache = new Map<string, { buf: Buffer; ptr: number }>();

function getMethodPtr(name: string): number {
  const cached = methodPtrCache.get(name);
  if (cached) return cached.ptr;
  const buf = Buffer.from(name + "\0");
  const pointer = ptr(buf);
  methodPtrCache.set(name, { buf, ptr: pointer });
  return pointer;
}

const MAX_WMI_ARGS = 16;
const MAX_WMI_ARG_NAME_LENGTH = 63;

function getUint8Argument(
  methodName: string,
  argName: string,
  value: number,
): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new RangeError(
      `WMI '${methodName}' argument '${argName}' must be an integer between 0 and 255; received ${value}`,
    );
  }

  return value;
}

function requireLib(): WmiLibrary["symbols"] {
  if (isClosed) {
    throw new Error("WMI library is already closed");
  }
  if (!lib) {
    throw new Error("WMI not initialized");
  }
  return lib.symbols;
}

function getLastError(): string {
  if (!lib) return "Unknown error";
  const errorPtr = lib.symbols.wmi_get_last_error();
  if (!errorPtr) return "Unknown error";
  return new CString(errorPtr).toString();
}

// Multi-argument WMI methods (e.g. SetLightBar, GetLightBar) transport the
// full argument map: NUL-separated names plus one uint8 value per name,
// which is the type of every GB_WMIACPI input parameter.
function buildNamedArgBuffers(methodName: string, args: Args) {
  const entries = Object.entries(args);
  if (entries.length < 1 || entries.length > MAX_WMI_ARGS) {
    throw new RangeError(
      `WMI '${methodName}' received ${entries.length} arguments; expected 1 to ${MAX_WMI_ARGS}`,
    );
  }

  const names: string[] = [];
  const values = new Uint8Array(entries.length);

  entries.forEach(([name, value], index) => {
    if (
      name.length < 1 ||
      name.length > MAX_WMI_ARG_NAME_LENGTH ||
      name.includes("\0")
    ) {
      throw new RangeError(
        `WMI '${methodName}' has an invalid argument name: ${JSON.stringify(name)}`,
      );
    }
    names.push(name);
    values[index] = getUint8Argument(methodName, name, value);
  });

  const namesBuf = Buffer.from(`${names.join("\0")}\0`);
  return {
    namesBuf,
    namesPtr: ptr(namesBuf),
    valuesPtr: ptr(values),
    count: entries.length,
  };
}

// The single-"Data" call shape keeps its fast path; every other shape
// (multiple names, or names other than "Data") goes through the named exports.
function usesNamedPath(args: Args | undefined): boolean {
  if (!args) return false;
  const keys = Object.keys(args);
  return keys.length > 0 && !(keys.length === 1 && keys[0] === "Data");
}

export async function wmiInit() {
  if (isClosed) {
    throw new Error("WMI library is already closed");
  }

  if (!(await Bun.file(dllPath).exists())) {
    throw new Error(
      `WmiDll.dll not found at ${dllPath}. Build it with 'bun run build:wmidll' (dev) or reinstall ALFC (release).`,
    );
  }

  let attempt = 0;
  while (attempt < 3) {
    try {
      // dlopen stays in the retry loop so a transiently locked DLL
      // (e.g. antivirus scan) can recover on the next attempt.
      const current = (lib ??= openWmiLibrary());
      const result = current.symbols.wmi_init();
      if (result !== 0) {
        throw new Error(`WMI init failed: ${getLastError()}`);
      }
      return;
    } catch (e) {
      attempt++;
      if (attempt >= 3) {
        console.error(`WMI init attempt ${attempt} failed. No more retries.`);
        throw e;
      }
      console.log(`WMI init attempt ${attempt} failed. Retrying in 2s...`);
      await Bun.sleep(2000);
    }
  }
}

export function setCall(_: string, methodName: string, args: Args) {
  return Promise.resolve().then(() => {
    const symbols = requireLib();

    if (usesNamedPath(args)) {
      const { namesBuf, namesPtr, valuesPtr, count } = buildNamedArgBuffers(
        methodName,
        args,
      );
      const result = symbols.wmi_set_named(
        getMethodPtr(methodName),
        namesPtr,
        namesBuf.length,
        valuesPtr,
        count,
      );
      if (result !== 0) {
        throw new Error(`WMI set '${methodName}' failed: ${getLastError()}`);
      }
      return;
    }

    const argValue = getUint8Argument(methodName, "Data", args.Data ?? 0);
    const result = symbols.wmi_set(getMethodPtr(methodName), argValue);
    if (result !== 0) {
      throw new Error(`WMI set '${methodName}' failed: ${getLastError()}`);
    }
  });
}

export function getCall(_: string, methodName: string, args?: Args) {
  return Promise.resolve().then(() => {
    const symbols = requireLib();

    if (args && usesNamedPath(args)) {
      const { namesBuf, namesPtr, valuesPtr, count } = buildNamedArgBuffers(
        methodName,
        args,
      );
      const result = symbols.wmi_get_named(
        getMethodPtr(methodName),
        namesPtr,
        namesBuf.length,
        valuesPtr,
        count,
        resultsPtr,
        countPtr,
      );
      if (result !== 0) {
        throw new Error(`WMI get '${methodName}' failed: ${getLastError()}`);
      }
    } else {
      const argValue =
        args?.Data === undefined
          ? -1
          : getUint8Argument(methodName, "Data", Number(args.Data));

      const result = symbols.wmi_get(
        getMethodPtr(methodName),
        argValue,
        resultsPtr,
        countPtr,
      );
      if (result !== 0) {
        throw new Error(`WMI get '${methodName}' failed: ${getLastError()}`);
      }
    }

    const resultCount = countBuffer[0] ?? 0;
    let value = 0;
    for (let i = resultCount - 1; i >= 0; i--) {
      const raw = resultsBuffer[i] ?? 0;
      if (raw > 255) {
        value = value * 256 + (raw >> 8);
        value = value * 256 + (raw & 0xff);
      } else {
        value = value * 256 + raw;
      }
    }

    return value;
  });
}

export function wmiCleanup() {
  if (isClosed) return;

  if (lib) {
    lib.symbols.wmi_cleanup();
    methodPtrCache.clear();
    lib.close();
    lib = null;
  }
  isClosed = true;
}

if (import.meta.main) {
  await wmiInit();
  console.log("RPM1", await getCall("doesntmatter", "getRpm1"));
}
