import { CString, dlopen, FFIType, ptr } from "bun:ffi";
import type { Pointer } from "bun:ffi";
import path from "node:path";
import type { Args } from "../../../common/types";
import { isDev } from "../../utils/consts";

const baseDir = isDev ? import.meta.dirname : path.dirname(process.execPath);
const dllPath = isDev
  ? path.join(baseDir, "wmidll", "WmiDll.dll")
  : path.join(baseDir, "WmiDll.dll");

const wmiLibrary = dlopen(dllPath, {
  wmi_init: { args: [], returns: FFIType.i32 },
  wmi_get: {
    args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
  wmi_set: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  wmi_cleanup: { args: [], returns: FFIType.void },
  wmi_get_last_error: { args: [], returns: FFIType.ptr },
});

function getLastError(): string {
  const errorPtr = wmiLibrary.symbols.wmi_get_last_error();
  if (!errorPtr) return "Unknown error";
  return new CString(errorPtr).toString();
}

const resultsBuffer = new Float64Array(16);
const countBuffer = new Int32Array(1);
const resultsPtr = ptr(resultsBuffer);
const countPtr = ptr(countBuffer);
let isClosed = false;

const methodPointerCache = new Map<
  string,
  { buffer: Buffer; pointer: Pointer }
>();

function getMethodPointer(name: string): Pointer {
  const cached = methodPointerCache.get(name);
  if (cached) return cached.pointer;
  const buffer = Buffer.from(name + "\0");
  const pointer = ptr(buffer);
  methodPointerCache.set(name, { buffer, pointer });
  return pointer;
}

function getUint8Argument(methodName: string, value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new RangeError(
      `WMI '${methodName}' Data must be an integer between 0 and 255; received ${value}`,
    );
  }

  return value;
}

function ensureLibraryOpen() {
  if (isClosed) {
    throw new Error("WMI library is already closed");
  }
}

<<<<<<< HEAD
function runWmiCall<T>(callback: () => T): Promise<T> {
  try {
    return Promise.resolve(callback());
  } catch (error) {
    return Promise.reject(error);
  }
}

function getRequiredDataArgument(methodName: string, args: Args): number {
  if (args.Data === undefined) {
    throw new TypeError(`WMI '${methodName}' requires a Data argument`);
  }

  return getUint8Argument(methodName, args.Data);
}

=======
>>>>>>> origin/feat/wmi-ffi
export async function wmiInit() {
  ensureLibraryOpen();

  let attempt = 0;
  while (attempt < 3) {
    try {
      const result = wmiLibrary.symbols.wmi_init();
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
<<<<<<< HEAD
  return runWmiCall(() => {
    ensureLibraryOpen();
    const argValue = getRequiredDataArgument(methodName, args);
    const result = wmiLibrary.symbols.wmi_set(
      getMethodPointer(methodName),
      argValue,
    );
=======
  return Promise.resolve().then(() => {
    ensureLibraryOpen();
    const argValue = getUint8Argument(methodName, args.Data ?? 0);
    const result = lib.symbols.wmi_set(getMethodPtr(methodName), argValue);
>>>>>>> origin/feat/wmi-ffi
    if (result !== 0) {
      throw new Error(`WMI set '${methodName}' failed: ${getLastError()}`);
    }
  });
}

export function getCall(_: string, methodName: string, args?: Args) {
<<<<<<< HEAD
  return runWmiCall(() => {
=======
  return Promise.resolve().then(() => {
>>>>>>> origin/feat/wmi-ffi
    ensureLibraryOpen();
    const argValue =
      args?.Data === undefined
        ? -1
        : getUint8Argument(methodName, Number(args.Data));

<<<<<<< HEAD
    const result = wmiLibrary.symbols.wmi_get(
      getMethodPointer(methodName),
=======
    const result = lib.symbols.wmi_get(
      getMethodPtr(methodName),
>>>>>>> origin/feat/wmi-ffi
      argValue,
      resultsPtr,
      countPtr,
    );

    if (result !== 0) {
      throw new Error(`WMI get '${methodName}' failed: ${getLastError()}`);
    }

    const count = countBuffer[0] ?? 0;
    let value = 0;
    for (let i = count - 1; i >= 0; i--) {
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

<<<<<<< HEAD
  wmiLibrary.symbols.wmi_cleanup();
  methodPointerCache.clear();
  wmiLibrary.close();
=======
  lib.symbols.wmi_cleanup();
  methodPtrCache.clear();
  lib.close();
>>>>>>> origin/feat/wmi-ffi
  isClosed = true;
}

if (import.meta.main) {
  await wmiInit();
  console.log("RPM1", await getCall("doesntmatter", "getRpm1"));
}
