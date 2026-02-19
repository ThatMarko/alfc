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

function encodeMethod(name: string): Buffer {
  return Buffer.from(name + "\0");
}

const resultsBuffer = new Float64Array(16);
const countBuffer = new Int32Array(1);

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
  const methodBuf = encodeMethod(methodName);
  const result = lib.symbols.wmi_set(ptr(methodBuf), argValue);
  if (result !== 0) {
    return Promise.reject(
      new Error(`WMI set '${methodName}' failed: ${getLastError()}`),
    );
  }
  return Promise.resolve();
}

function splitWords(numbers: number[]) {
  for (let i = 0; i < numbers.length; i++) {
    const current = numbers[i] ?? 0;
    if (current > 255) {
      numbers[i] = current >> 8;
      numbers.splice(i + 1, 0, current & 0xff);
    }
  }
}

export function getCall(_: string, methodName: string, args?: Args) {
  const argValue = args?.Data !== undefined ? Number(args.Data) : -1;
  const methodBuf = encodeMethod(methodName);

  const result = lib.symbols.wmi_get(
    ptr(methodBuf),
    argValue,
    ptr(resultsBuffer),
    ptr(countBuffer),
  );

  if (result !== 0) {
    return Promise.reject(
      new Error(`WMI get '${methodName}' failed: ${getLastError()}`),
    );
  }

  const count = countBuffer[0] ?? 0;
  const data: number[] = [];
  for (let i = 0; i < count; i++) {
    data.push(resultsBuffer[i] ?? 0);
  }

  data.reverse();
  splitWords(data);

  let value = 0;
  for (const byte of data) {
    value = value * 256 + byte;
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
