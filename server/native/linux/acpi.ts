import { getMethods, setMethods } from "../../../common/methods";
import type { WmiMethods } from "../../../common/methods";
import type { Args, NativeResult } from "../../../common/types";

const ACPI_CALL_PATH = "/proc/acpi/call";
const MAX_ACPI_INPUT_BYTES = 8;

let _acpiAvailable: boolean | undefined;

export async function isAcpiAvailable() {
  if (_acpiAvailable === undefined) {
    _acpiAvailable = await Bun.file(ACPI_CALL_PATH).exists();
    if (!_acpiAvailable) {
      console.warn(
        `[ACPI] ${ACPI_CALL_PATH} not found. ACPI calls will be disabled.`,
      );
    }
  }
  return _acpiAvailable;
}

export function isAvailable() {
  return isAcpiAvailable();
}

const ACPI_METHOD_ID_PATTERN = /^(?:0x[\da-f]+|\d+)$/i;

function validateMethodId(methodId: string): string {
  if (!ACPI_METHOD_ID_PATTERN.test(methodId)) {
    throw new RangeError(`Invalid ACPI methodId: ${JSON.stringify(methodId)}`);
  }
  // acpi_call's argument parser recognizes only a lowercase "0x" prefix.
  // Its decimal branch parses an otherwise valid "0XE1" as zero.
  return methodId.toLowerCase();
}

function argsToHexString(
  methods: WmiMethods,
  methodId: string,
  methodName: string,
  args: Args = {},
) {
  validateMethodId(methodId);
  const method = Object.hasOwn(methods, methodName)
    ? methods[methodName]
    : undefined;
  if (!method || Number(method.methodId) !== Number(methodId)) {
    throw new RangeError(
      `Unknown or mismatched ACPI method: ${methodId} ${methodName}`,
    );
  }
  const expectedNames = method.inArgs.map((argument) => argument.name);
  if (
    Object.keys(args).length !== expectedNames.length ||
    expectedNames.some((name) => !Object.hasOwn(args, name))
  ) {
    throw new TypeError(
      `ACPI '${methodName}' requires arguments: ${expectedNames.join(", ") || "none"}`,
    );
  }
  // All catalog inputs are uint8. acpi_call parses this packed argument as
  // one machine-width integer, so an otherwise valid wider signature loses
  // its upper bytes on the supported 64-bit targets. Do not dispatch it.
  if (expectedNames.length > MAX_ACPI_INPUT_BYTES) {
    throw new RangeError(
      `ACPI '${methodName}' requires ${expectedNames.length} input bytes; the Linux 8-byte ACPI integer transport cannot represent this signature`,
    );
  }
  // JSON object insertion order is not the firmware's argument order. Follow
  // the shared MOF declaration so Linux matches Windows named WMI calls.
  const values = expectedNames.map((name) => {
    const value = args[name];
    if (value === undefined)
      throw new TypeError(`Missing ACPI argument: ${name}`);
    if (!Number.isInteger(value) || value < 0 || value > 0xff) {
      throw new RangeError(
        `ACPI argument must be an integer between 0 and 255; received ${value}`,
      );
    }
    return value;
  });
  if (!values.length) return "0";

  // Reversed to match WMI byte order convention
  return "0x" + Buffer.from([...values].reverse()).toString("hex");
}

function readResponse(text: string) {
  const response = text.replaceAll("\0", "").trim();
  if (!response || response === "not called" || response.startsWith("Error:")) {
    throw new Error(`ACPI call failed: ${response || "empty response"}`);
  }
  return response;
}

function parseResult(response: string, outputBytes: number): NativeResult {
  let result: bigint;
  if (/^0x[\da-f]+$/i.test(response)) {
    result = BigInt(response);
  } else if (
    /^\{\s*0x[\da-f]{1,2}(?:\s*,\s*0x[\da-f]{1,2})*\s*\}$/i.test(response)
  ) {
    const bytes = response
      .slice(1, -1)
      .split(",")
      .map((byte) => BigInt(byte.trim()));
    if (bytes.length !== outputBytes) {
      throw new Error(
        `Invalid ACPI byte count: ${bytes.length}; expected ${outputBytes}`,
      );
    }
    result = bytes.reduceRight((value, byte) => (value << 8n) | byte, 0n);
  } else {
    throw new Error(`Invalid ACPI result: ${response}`);
  }
  if (outputBytes < 1 || result >= 1n << BigInt(outputBytes * 8)) {
    throw new Error(
      `ACPI result exceeds its declared ${outputBytes}-byte output`,
    );
  }
  return result <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(result)
    : result.toString();
}

export function wmiInit() {
  return Promise.resolve();
}

export async function getCall(
  methodId: string,
  methodName: string,
  args?: Args,
): Promise<NativeResult> {
  if (!(await isAcpiAvailable())) {
    return NaN;
  }

  try {
    const command = `\\_SB.PCI0.AMW0.WMBC 0 ${validateMethodId(methodId)} ${argsToHexString(getMethods, methodId, methodName, args)}`;
    await Bun.write(ACPI_CALL_PATH, command);
    const result = await Bun.file(ACPI_CALL_PATH).text();
    const outputBytes =
      getMethods[methodName]?.outArgs.reduce((count, argument) => {
        if (argument.type === "uint8") return count + 1;
        if (argument.type === "uint16") return count + 2;
        throw new TypeError(`Unsupported ACPI output type '${argument.type}'`);
      }, 0) ?? 0;
    return parseResult(readResponse(result), outputBytes);
  } catch (error) {
    console.error(`[ACPI] getCall failed for ${methodId}:`, error);
    return NaN;
  }
}

export function wmiCleanup() {}

export async function setCall(
  methodId: string,
  methodName: string,
  args: Args,
) {
  if (!(await isAcpiAvailable())) {
    throw new Error(`${ACPI_CALL_PATH} is not available`);
  }

  const command = `\\_SB.PCI0.AMW0.WMBD 0 ${validateMethodId(methodId)} ${argsToHexString(setMethods, methodId, methodName, args)}`;
  try {
    await Bun.write(ACPI_CALL_PATH, command);
    // acpi_call reports firmware errors through its read result, even when
    // the preceding write succeeds. Never acknowledge a rejected write.
    readResponse(await Bun.file(ACPI_CALL_PATH).text());
  } catch (error) {
    console.error(`[ACPI] setCall failed for ${methodId}:`, error);
    throw error;
  }
}
