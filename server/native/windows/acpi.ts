import { CString, dlopen, FFIType, ptr } from "bun:ffi";
import path from "node:path";
import type { Args } from "../../../common/types";
import { isDev } from "../../utils/consts";

const baseDir = isDev ? import.meta.dirname : path.dirname(process.execPath);
const dllPath = path.join(baseDir, "WmiAPI.dll");

if (!(await Bun.file(dllPath).exists())) {
  throw new Error(`WmiAPI.dll not found at ${dllPath}`);
}

const lib = dlopen(dllPath, {
  wmi_init: { args: [], returns: FFIType.i32 },
  wmi_get: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  wmi_set: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  free_string: { args: [FFIType.ptr], returns: FFIType.void },
  get_last_error: { args: [], returns: FFIType.ptr },
});

function getLastError(): string {
  const errorPtr = lib.symbols.get_last_error();
  if (!errorPtr) return "Unknown error";
  const error = new CString(errorPtr);
  lib.symbols.free_string(errorPtr);
  return error.toString();
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
  const nameBuf = Buffer.from(methodName + "\0", "utf-8");
  const argsBuf = Buffer.from(JSON.stringify(args) + "\0", "utf-8");

  const result = lib.symbols.wmi_set(ptr(nameBuf), ptr(argsBuf));
  if (result !== 0) {
    throw new Error(`WMI set '${methodName}' failed: ${getLastError()}`);
  }
  return Promise.resolve();
}

// uint16 values are already little-endian, just need to split them up
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
  const nameBuf = Buffer.from(methodName + "\0", "utf-8");
  const argsBuf = args
    ? Buffer.from(JSON.stringify(args) + "\0", "utf-8")
    : null;

  const resultPtr = lib.symbols.wmi_get(
    ptr(nameBuf),
    argsBuf ? ptr(argsBuf) : null,
  );
  if (!resultPtr) {
    throw new Error(`WMI get '${methodName}' failed: ${getLastError()}`);
  }

  const resultJson = new CString(resultPtr);
  lib.symbols.free_string(resultPtr);

  const result: number[] = JSON.parse(resultJson.toString()).reverse();
  splitWords(result);

  let value = 0;
  for (const byte of result) {
    value = value * 256 + byte;
  }
  return Promise.resolve(value);
}

if (import.meta.main) {
  await wmiInit();
  console.log("RPM1", await getCall("doesntmatter", "getRpm1"));
}
