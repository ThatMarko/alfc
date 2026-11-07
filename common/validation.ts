// Shared boundary validation for values that command fan hardware.
// The rules mirror what the Plasma fan curve editor already enforces
// client-side; the server re-checks them because raw clients and hand-edited
// config files bypass every UI. Returns a human-readable reason, or null
// when the value is valid.
//
// The fan-table rules are safety rules, not just shape rules: a curve that
// cannot reach a high speed while the machine is hot leaves the hardware
// with no way to cool itself, and the fail-hot fallback reads its target
// from these same tables. Fractional temperatures and speeds stay allowed
// (the curve editors support them); only the thermal coverage is enforced.
export const MAX_FAN_TABLE_ENTRIES = 16;
export const MIN_EMERGENCY_FAN_SPEED = 85;
export const MAX_EMERGENCY_FAN_TEMP = 90;

export function validateFanTable(table: unknown): string | null {
  if (!Array.isArray(table)) {
    return "must be an array of [temperature, speed] entries";
  }

  if (table.length === 0) {
    return "must contain at least one entry";
  }

  if (table.length > MAX_FAN_TABLE_ENTRIES) {
    return `must contain at most ${MAX_FAN_TABLE_ENTRIES} entries (got ${table.length})`;
  }

  let previousTemp: number | undefined;
  let previousSpeed: number | undefined;

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

    // A curve that spins the fans down as the machine gets hotter is a
    // misconfiguration the controller would faithfully obey.
    if (previousSpeed !== undefined && speed < previousSpeed) {
      return "speeds must not decrease as temperature rises";
    }

    previousTemp = temperature;
    previousSpeed = speed;
  }

  // The last entry is the fastest the curve can ever command, and the
  // fail-hot fallback reads the same maximum. A curve that never reaches a
  // high speed while the machine is hot (for example [[30, 10]] or an
  // all-zero table) cannot cool the hardware at all.
  const last = table[table.length - 1];
  if (
    !last ||
    last[0] > MAX_EMERGENCY_FAN_TEMP ||
    last[1] < MIN_EMERGENCY_FAN_SPEED
  ) {
    return `the last entry must reach at least ${MIN_EMERGENCY_FAN_SPEED}% fan speed by ${MAX_EMERGENCY_FAN_TEMP}°C`;
  }

  return null;
}

// CPU power limits are hardware commands, not preferences: 0 W starves the
// CPU until it freezes, a sustained limit above the short-term limit is
// meaningless, and 200 W sustained would exceed what a laptop chassis can
// dissipate. These bounds are conservative policy, not a hardware rating
// for a specific model — confirm them against the supported machines
// before widening them.
export const MIN_POWER_LIMIT_WATTS = 15;
export const MAX_PL1_WATTS = 115;
export const MAX_PL2_WATTS = 150;

export function validatePowerLimits(pl1: unknown, pl2: unknown): string | null {
  if (
    typeof pl1 !== "number" ||
    !Number.isInteger(pl1) ||
    pl1 < MIN_POWER_LIMIT_WATTS ||
    pl1 > MAX_PL1_WATTS
  ) {
    return `pl1 must be an integer between ${MIN_POWER_LIMIT_WATTS} and ${MAX_PL1_WATTS}`;
  }

  if (
    typeof pl2 !== "number" ||
    !Number.isInteger(pl2) ||
    pl2 < pl1 ||
    pl2 > MAX_PL2_WATTS
  ) {
    return `pl2 must be an integer between pl1 and ${MAX_PL2_WATTS}`;
  }

  return null;
}

export function validateFixedPercentage(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return "must be an integer";
  }

  if (value < 0 || value > 100) {
    return `must be between 0 and 100 (got ${value})`;
  }

  return null;
}
