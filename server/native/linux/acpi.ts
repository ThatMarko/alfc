import type { Args } from "../../../common/types.js";

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

  // TODO: Test whether this order inversion works with GetFanIndexValue!
  return "0x" + Buffer.from(Object.values(args).reverse()).toString("hex");
}

export function wmiInit() {
  return Promise.resolve();
}

// Read calls also always expect 3 arguments.
// IF something really needs to be specified, it's packed into the 3rd argument, like with write.
// Otherwise, it's simply not used.
// @return Multiple values are returned in a single number, little endian!
// TODO: Convert to a number instead of returning a hex string. For Windows as well, obviously
export async function getCall(methodId: string, _: string, args?: Args) {
  if (!(await isAcpiAvailable())) {
    return "";
  }

  const command = `\\_SB.PCI0.AMW0.WMBC 0 ${methodId} ${argstoHexString(args)}`;
  try {
    await Bun.write(ACPI_CALL_PATH, command);
    const result = await Bun.file(ACPI_CALL_PATH).text();
    return result.replace("\0", "");
  } catch (error) {
    console.error(`[ACPI] getCall failed for ${methodId}:`, error);
    return "";
  }
}

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
