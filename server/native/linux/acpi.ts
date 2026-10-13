import type { Args } from "../../../common/types";

const ACPI_CALL_PATH = "/proc/acpi/call";

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

const ACPI_METHOD_ID_PATTERN = /^(?:0x[0-9a-fA-F]+|\d+)$/;

function validateMethodId(methodId: string): string {
  if (!ACPI_METHOD_ID_PATTERN.test(methodId)) {
    throw new RangeError(`Invalid ACPI methodId: ${JSON.stringify(methodId)}`);
  }
  return methodId;
}

// Precondition: There are no uint16 arguments.
function argstoHexString(args?: Args) {
  if (!args) {
    return "0";
  }

  const values = Object.values(args);
  if (values.length === 0) {
    return "0";
  }

  for (const value of values) {
    if (!Number.isInteger(value) || value < 0 || value > 0xff) {
      throw new RangeError(
        `ACPI argument must be an integer between 0 and 255; received ${value}`,
      );
    }
  }

  // Reversed to match WMI byte order convention
  return "0x" + Buffer.from([...values].reverse()).toString("hex");
}

export function wmiInit() {
  return Promise.resolve();
}

export async function getCall(methodId: string, _: string, args?: Args) {
  if (!(await isAcpiAvailable())) {
    return NaN;
  }

  try {
    const command = `\\_SB.PCI0.AMW0.WMBC 0 ${validateMethodId(methodId)} ${argstoHexString(args)}`;
    await Bun.write(ACPI_CALL_PATH, command);
    const result = await Bun.file(ACPI_CALL_PATH).text();
    return parseInt(result.replaceAll("\0", "").trim(), 16);
  } catch (error) {
    console.error(`[ACPI] getCall failed for ${methodId}:`, error);
    return NaN;
  }
}

export function wmiCleanup() {}

export async function setCall(methodId: string, _: string, args: Args) {
  if (!(await isAcpiAvailable())) {
    throw new Error(`${ACPI_CALL_PATH} is not available`);
  }

  const command = `\\_SB.PCI0.AMW0.WMBD 0 ${validateMethodId(methodId)} ${argstoHexString(args)}`;
  try {
    await Bun.write(ACPI_CALL_PATH, command);
  } catch (error) {
    console.error(`[ACPI] setCall failed for ${methodId}:`, error);
    throw error;
  }
}
