// Shared boundary validation for values that command fan hardware.
// The rules mirror what the Plasma fan curve editor already enforces
// client-side; the server re-checks them because raw clients and hand-edited
// config files bypass every UI. Returns a human-readable reason, or null
// when the value is valid.
export function validateFanTable(table: unknown): string | null {
  if (!Array.isArray(table)) {
    return "must be an array of [temperature, speed] entries";
  }

  if (table.length === 0) {
    return "must contain at least one entry";
  }

  let previousTemp: number | undefined;

  for (const entry of table) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== "number" ||
      !Number.isFinite(entry[0]) ||
      typeof entry[1] !== "number" ||
      !Number.isFinite(entry[1])
    ) {
      return "entries must be [temperature, speed] pairs of finite numbers";
    }

    const [temperature, speed] = entry;

    if (temperature < 0 || temperature > 110) {
      return `temperatures must be between 0 and 110 (got ${temperature})`;
    }

    if (speed < 0 || speed > 100) {
      return `speeds must be between 0 and 100 (got ${speed})`;
    }

    // findHighestMatch breaks at the first entry above the current
    // temperature — a non-ascending table silently selects wrong targets.
    if (previousTemp !== undefined && temperature <= previousTemp) {
      return "temperatures must be strictly ascending";
    }

    previousTemp = temperature;
  }

  return null;
}

export function validateFixedPercentage(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "must be a number";
  }

  if (value < 0 || value > 100) {
    return `must be between 0 and 100 (got ${value})`;
  }

  return null;
}
