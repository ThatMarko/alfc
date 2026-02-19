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

// Precondition: There are no uint16 arguments.
function argstoHexString(args?: Args) {
  if (!args) {
    return "0";
  }

  // Reversed to match WMI byte order convention
  return "0x" + Buffer.from(Object.values(args).reverse()).toString("hex");
}

export function wmiInit() {
  return Promise.resolve();
}

export async function getCall(methodId: string, _: string, args?: Args) {
  if (!(await isAcpiAvailable())) {
    return NaN;
  }

  const command = `\\_SB.PCI0.AMW0.WMBC 0 ${methodId} ${argstoHexString(args)}`;
  try {
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
    return;
  }

  const command = `\\_SB.PCI0.AMW0.WMBD 0 ${methodId} ${argstoHexString(args)}`;
  try {
    await Bun.write(ACPI_CALL_PATH, command);
  } catch (error) {
    console.error(`[ACPI] setCall failed for ${methodId}:`, error);
    throw error;
  }
}
