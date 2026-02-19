import { CString, dlopen, FFIType, ptr } from "bun:ffi";
import path from "node:path";
import type { Args } from "../../../common/types";
import { isDev } from "../../utils/consts";

const baseDir = isDev ? import.meta.dirname : path.dirname(process.execPath);
const dllPath = path.join(baseDir, "WmiDll.dll");

const lib = dlopen(dllPath, {
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
  const errorPtr = lib.symbols.wmi_get_last_error();
  if (!errorPtr) return "Unknown error";
  return new CString(errorPtr).toString();
}

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

export async function wmiInit() {
  let attempt = 0;
  while (attempt < 3) {
    try {
      const result = lib.symbols.wmi_init();
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
  const argValue = typeof args.Data === "number" ? args.Data : 0;
  const result = lib.symbols.wmi_set(getMethodPtr(methodName), argValue);
  if (result !== 0) {
    return Promise.reject(
      new Error(`WMI set '${methodName}' failed: ${getLastError()}`),
    );
  }
  return Promise.resolve();
}

export function getCall(_: string, methodName: string, args?: Args) {
  const argValue = args?.Data !== undefined ? Number(args.Data) : -1;

  const result = lib.symbols.wmi_get(
    getMethodPtr(methodName),
    argValue,
    resultsPtr,
    countPtr,
  );

  if (result !== 0) {
    return Promise.reject(
      new Error(`WMI get '${methodName}' failed: ${getLastError()}`),
    );
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

  return Promise.resolve(value);
}

export function wmiCleanup() {
  lib.symbols.wmi_cleanup();
}

if (import.meta.main) {
  await wmiInit();
  console.log("RPM1", await getCall("doesntmatter", "getRpm1"));
}
