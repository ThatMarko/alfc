import {
  MAX_FAN_TABLE_ENTRIES,
  validateFanTable,
  validatePowerLimits,
} from "./validation";

describe("validateFanTable", () => {
  it("accepts the shipped curves", () => {
    expect(
      validateFanTable([
        [40, 15],
        [83, 50],
        [88, 100],
      ]),
    ).toBeNull();
    expect(
      validateFanTable([
        [40, 15],
        [78, 50],
        [83, 100],
      ]),
    ).toBeNull();
  });

  it("accepts fractional entries", () => {
    expect(
      validateFanTable([
        [40.5, 15.5],
        [83.5, 100],
      ]),
    ).toBeNull();
  });

  it("rejects a curve that cannot cool the hardware", () => {
    // An all-zero curve also zeroes the fail-hot fallback.
    expect(validateFanTable([[0, 0]])).toMatch(/at least 85%/);
    // A single low entry caps the fans at 10% at any temperature.
    expect(validateFanTable([[30, 10]])).toMatch(/at least 85%/);
    // Reaching full speed only at 110°C leaves 90°C uncooled.
    expect(
      validateFanTable([
        [40, 15],
        [110, 100],
      ]),
    ).toMatch(/at least 85%/);
  });

  it("accepts the emergency-floor boundary exactly", () => {
    // Exactly 85% at exactly 90°C is the boundary: valid.
    expect(validateFanTable([[90, 85]])).toBeNull();
    expect(
      validateFanTable([
        [40, 15],
        [90, 85],
      ]),
    ).toBeNull();
    // Just past it on either side is invalid.
    expect(validateFanTable([[90, 84.9]])).toMatch(/at least 85%/);
    expect(
      validateFanTable([
        [40, 15],
        [90.5, 100],
      ]),
    ).toMatch(/at least 85%/);
  });

  it("accepts a full 16-entry table", () => {
    const table = Array.from({ length: MAX_FAN_TABLE_ENTRIES }, (_, i) => [
      i * 5,
      85 + Math.min(i, 15),
    ]);
    expect(validateFanTable(table)).toBeNull();
  });

  it("rejects speeds that decrease as temperature rises", () => {
    expect(
      validateFanTable([
        [40, 100],
        [83, 50],
        [88, 100],
      ]),
    ).toMatch(/must not decrease/);
  });

  it("rejects unbounded tables", () => {
    const table = Array.from({ length: MAX_FAN_TABLE_ENTRIES + 1 }, (_, i) => [
      i,
      100,
    ]);
    expect(validateFanTable(table)).toMatch(/at most 16 entries/);
  });

  it("keeps the existing shape rules", () => {
    expect(validateFanTable([])).toMatch(/at least one entry/);
    expect(validateFanTable([[111, 50]])).toMatch(/between 0 and 110/);
    expect(validateFanTable([[40, 101]])).toMatch(/between 0 and 100/);
    expect(
      validateFanTable([
        [80, 50],
        [40, 15],
      ]),
    ).toMatch(/strictly ascending/);
    expect(validateFanTable([[40.5, "50"]])).toMatch(/finite numbers/);
  });
});

describe("validatePowerLimits", () => {
  it("accepts the shipped limits and ordinary retunes", () => {
    expect(validatePowerLimits(37, 106)).toBeNull();
    expect(validatePowerLimits(15, 15)).toBeNull();
    expect(validatePowerLimits(115, 150)).toBeNull();
  });

  it("rejects starving and meaningless limits", () => {
    expect(validatePowerLimits(0, 106)).toMatch(/pl1 must be an integer/);
    expect(validatePowerLimits(14, 106)).toMatch(/pl1 must be an integer/);
    expect(validatePowerLimits(37, 200)).toMatch(/pl2 must be an integer/);
    expect(validatePowerLimits(50, 40)).toMatch(/pl2 must be an integer/);
    expect(validatePowerLimits(37.5, 106)).toMatch(/pl1 must be an integer/);
    expect(validatePowerLimits("37", 106)).toMatch(/pl1 must be an integer/);
  });
});
