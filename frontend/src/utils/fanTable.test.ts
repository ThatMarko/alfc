import { fanTableInsertionTemperature } from "./fanTable";

describe("fan curve row insertion", () => {
  it("inserts strictly between existing rows and allows zero before the first row", () => {
    const table: [string, string][] = [
      ["40", "15"],
      ["83.5", "50"],
    ];
    expect(fanTableInsertionTemperature(table, 0)).toBe(20);
    expect(fanTableInsertionTemperature(table, 1)).toBe(61.75);
    expect(
      fanTableInsertionTemperature([[String(Number.MIN_VALUE), "15"]], 0),
    ).toBe(0);
  });

  it("does not insert a duplicate when adjacent numbers have no representable midpoint", () => {
    expect(
      fanTableInsertionTemperature(
        [
          ["0", "15"],
          [String(Number.MIN_VALUE), "50"],
        ],
        1,
      ),
    ).toBeNull();
    expect(
      fanTableInsertionTemperature(
        [
          ["1", "15"],
          [String(1 + Number.EPSILON), "50"],
        ],
        1,
      ),
    ).toBeNull();
  });

  it("disables insertion at zero and into invalid drafts", () => {
    for (const value of ["0", "", " ", "NaN", "Infinity", "-1", "111"]) {
      expect(fanTableInsertionTemperature([[value, "15"]], 0)).toBeNull();
    }
    expect(fanTableInsertionTemperature([], 0)).toBeNull();
    expect(
      fanTableInsertionTemperature(
        [
          ["83", "15"],
          ["40", "50"],
        ],
        1,
      ),
    ).toBeNull();
  });
});
