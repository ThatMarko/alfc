import { CString, dlopen, FFIType, ptr } from "bun:ffi";
import type { Pointer } from "bun:ffi";
import path from "node:path";
import {
  getMethods,
  setMethods,
  type WmiMethods,
} from "../../../common/methods";
import type { Args, NativeResult } from "../../../common/types";
import { isDev } from "../../utils/consts";

const baseDir = isDev ? import.meta.dirname : path.dirname(process.execPath);
const dllPath = isDev
  ? path.join(baseDir, "wmidll", "WmiDll.dll")
  : path.join(baseDir, "WmiDll.dll");

// Loaded lazily inside wmiInit() so a missing or blocked DLL is a recoverable
// initialization failure (matching cpuoc.ts) instead of a module-evaluation crash.
function openWmiLibrary() {
  return dlopen(dllPath, {
    wmi_abi_version: { args: [], returns: FFIType.i32 },
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
let isInitialized = false;
let isPoisoned = false;
let initialization: Promise<void> | null = null;

const resultsBuffer = new Float64Array(16);
const countBuffer = new Int32Array(1);
const resultsPtr = ptr(resultsBuffer);
const countPtr = ptr(countBuffer);

const methodPtrCache = new Map<string, { buf: Buffer; ptr: Pointer }>();

function getMethodPtr(name: string): Pointer {
  const cached = methodPtrCache.get(name);
  if (cached) return cached.ptr;
  const buf = Buffer.from(name + "\0");
  const pointer = ptr(buf);
  methodPtrCache.set(name, { buf, ptr: pointer });
  return pointer;
}

const MAX_WMI_ARGS = 16;
const MAX_WMI_ARG_NAME_LENGTH = 63;
const argNamesBuffer = Buffer.alloc(
  MAX_WMI_ARGS * (MAX_WMI_ARG_NAME_LENGTH + 1),
);
const argValuesBuffer = new Uint8Array(MAX_WMI_ARGS);
const argNamesPtr = ptr(argNamesBuffer);
const argValuesPtr = ptr(argValuesBuffer);

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
  if (!lib || !isInitialized) {
    throw new Error("WMI not initialized");
  }
  if (isPoisoned)
    throw new Error(
      "WMI call timed out; restart ALFC before issuing more commands",
    );
  return lib.symbols;
}

function nativeFailure(operation: string, result: number): never {
  if (result === -2) isPoisoned = true;
  throw Object.assign(new Error(`WMI ${operation} failed: ${getLastError()}`), {
    restartRequired: result === -2,
  });
}

function validateCall(methods: WmiMethods, methodName: string, args?: Args) {
  const method = Object.hasOwn(methods, methodName)
    ? methods[methodName]
    : undefined;
  if (!method) throw new TypeError(`Unknown WMI method '${methodName}'`);

  const entries = Object.entries(args ?? {});
  for (const [name, value] of entries) {
    if (!method.inArgs.some((argument) => argument.name === name)) {
      throw new TypeError(
        `WMI '${methodName}' has no input argument '${name}'`,
      );
    }
    getUint8Argument(methodName, name, value);
  }
  for (const argument of method.inArgs) {
    if (!args || !Object.hasOwn(args, argument.name)) {
      throw new TypeError(
        `WMI '${methodName}' requires a ${argument.name} argument`,
      );
    }
  }
  return method;
}

function getLastError(): string {
  if (!lib) return "Unknown error";
  const errorPtr = lib.symbols.wmi_get_last_error();
  if (!errorPtr) return "Unknown error";
  return new CString(errorPtr).toString();
}

// Multi-argument WMI methods (e.g. SetLightBar, GetLightBar) transport the
// full argument map: NUL-separated names plus one uint8 value per name,
// which is the type of every GB_WMIACPI input parameter. Writes into
// module-scoped buffers so FFI pointers stay GC-rooted across the call.
function buildNamedArgBuffers(methodName: string, args: Args) {
  const entries = Object.entries(args);
  if (entries.length < 1 || entries.length > MAX_WMI_ARGS) {
    throw new RangeError(
      `WMI '${methodName}' received ${entries.length} arguments; expected 1 to ${MAX_WMI_ARGS}`,
    );
  }

  let namesByteLength = 0;

  entries.forEach(([name, value], index) => {
    const nameBytes = Buffer.byteLength(name, "utf8");
    if (
      nameBytes < 1 ||
      nameBytes > MAX_WMI_ARG_NAME_LENGTH ||
      name.includes("\0")
    ) {
      throw new RangeError(
        `WMI '${methodName}' has an invalid argument name: ${JSON.stringify(name)}`,
      );
    }
    argNamesBuffer.write(name, namesByteLength, "utf8");
    namesByteLength += nameBytes;
    argNamesBuffer[namesByteLength] = 0;
    namesByteLength += 1;
    argValuesBuffer[index] = getUint8Argument(methodName, name, value);
  });

  return {
    namesPtr: argNamesPtr,
    namesByteLength,
    valuesPtr: argValuesPtr,
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

async function initialize() {
  if (isClosed) {
    throw new Error("WMI library is already closed");
  }
  if (isPoisoned)
    throw new Error(
      "WMI call timed out; restart ALFC before initializing again",
    );

  if (!(await Bun.file(dllPath).exists())) {
    throw new Error(
      `WmiDll.dll not found at ${dllPath}. Build it with 'bun run build:wmidll' (dev) or reinstall ALFC (release).`,
    );
  }

  let attempt = 0;
  while (attempt < 3) {
    if (isClosed) throw new Error("WMI library is already closed");
    try {
      // dlopen stays in the retry loop so a transiently locked DLL
      // (e.g. antivirus scan) can recover on the next attempt.
      const current = (lib ??= openWmiLibrary());
      if (current.symbols.wmi_abi_version() !== 2) {
        throw new Error(
          "WmiDll.dll has an incompatible ABI; rebuild or reinstall ALFC",
        );
      }
      const result = current.symbols.wmi_init();
      if (result !== 0) {
        nativeFailure("init", result);
      }
      isInitialized = true;
      return;
    } catch (e) {
      isInitialized = false;
      attempt++;
      if (attempt >= 3 || isPoisoned) {
        console.error(`WMI init attempt ${attempt} failed. No more retries.`);
        // A later explicit initialization can retry, but a failed attempt must
        // never leave an apparently usable library or retain native resources.
        try {
          releaseLibrary();
        } catch {
          /* Preserve the initialization failure. */
        }
        throw e;
      }
      console.log(`WMI init attempt ${attempt} failed. Retrying in 2s...`);
      await Bun.sleep(2000);
    }
  }
}

export function wmiInit() {
  if (isClosed)
    return Promise.reject(new Error("WMI library is already closed"));
  return (initialization ??= initialize().finally(() => {
    initialization = null;
  }));
}

export function setCall(_: string, methodName: string, args: Args) {
  return Promise.resolve().then(() => {
    const symbols = requireLib();
    validateCall(setMethods, methodName, args);

    if (usesNamedPath(args)) {
      const { namesPtr, namesByteLength, valuesPtr, count } =
        buildNamedArgBuffers(methodName, args);
      const result = symbols.wmi_set_named(
        getMethodPtr(methodName),
        namesPtr,
        namesByteLength,
        valuesPtr,
        count,
      );
      if (result !== 0) {
        nativeFailure(`set '${methodName}'`, result);
      }
      return;
    }

    if (args.Data === undefined) {
      throw new TypeError(`WMI '${methodName}' requires a Data argument`);
    }
    const argValue = getUint8Argument(methodName, "Data", args.Data);
    const result = symbols.wmi_set(getMethodPtr(methodName), argValue);
    if (result !== 0) {
      nativeFailure(`set '${methodName}'`, result);
    }
  });
}

export function getCall(
  _: string,
  methodName: string,
  args?: Args,
): Promise<NativeResult> {
  return Promise.resolve().then(() => {
    const symbols = requireLib();
    const method = validateCall(getMethods, methodName, args);
    countBuffer[0] = 0;
    resultsBuffer.fill(Number.NaN);

    if (args && usesNamedPath(args)) {
      const { namesPtr, namesByteLength, valuesPtr, count } =
        buildNamedArgBuffers(methodName, args);
      const result = symbols.wmi_get_named(
        getMethodPtr(methodName),
        namesPtr,
        namesByteLength,
        valuesPtr,
        count,
        resultsPtr,
        countPtr,
      );
      if (result !== 0) {
        nativeFailure(`get '${methodName}'`, result);
      }
    } else {
      const argValue =
        args?.Data === undefined
          ? -1
          : getUint8Argument(methodName, "Data", args.Data);

      const result = symbols.wmi_get(
        getMethodPtr(methodName),
        argValue,
        resultsPtr,
        countPtr,
      );
      if (result !== 0) {
        nativeFailure(`get '${methodName}'`, result);
      }
    }

    const resultCount = countBuffer[0] ?? 0;
    const expectedBytes = method.outArgs.reduce((count, argument) => {
      if (argument.type === "uint8") return count + 1;
      if (argument.type === "uint16") return count + 2;
      throw new TypeError(`Unsupported WMI output type '${argument.type}'`);
    }, 0);
    if (
      !Number.isInteger(resultCount) ||
      resultCount < 1 ||
      resultCount > resultsBuffer.length ||
      resultCount !== expectedBytes
    ) {
      throw new Error(
        `WMI '${methodName}' returned an invalid byte count: ${resultCount}; expected ${expectedBytes}`,
      );
    }
    let value = 0n;
    for (let i = resultCount - 1; i >= 0; i--) {
      const raw = resultsBuffer[i];
      if (raw === undefined || !Number.isInteger(raw) || raw < 0 || raw > 255) {
        throw new Error(`WMI '${methodName}' returned an invalid byte at ${i}`);
      }
      value = value * 256n + BigInt(raw);
    }

    return value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  });
}

function releaseLibrary() {
  const current = lib;
  lib = null;
  isInitialized = false;
  try {
    current?.symbols.wmi_cleanup();
  } finally {
    methodPtrCache.clear();
    current?.close();
  }
}

export function wmiCleanup() {
  if (isClosed) return;
  isClosed = true;
  releaseLibrary();
}

if (import.meta.main) {
  await wmiInit();
  console.log("RPM1", await getCall("doesntmatter", "getRpm1"));
}
