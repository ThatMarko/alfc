const { mockSuccess, mockError } = vi.hoisted(() => ({
  mockSuccess: vi.fn(),
  mockError: vi.fn(),
}));

vi.mock("react-toastify/unstyled", () => ({
  toast: {
    success: mockSuccess,
    error: mockError,
  },
}));

import { theme } from "./consts";
import {
  errorToast,
  getFanTableRowError,
  nextRequestId,
  parseIntegerInRange,
  successToast,
  validationToast,
} from "./misc";

describe("toast utility wrappers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls toast.success with expected options", () => {
    successToast("Saved");

    expect(mockSuccess).toHaveBeenCalledTimes(1);
    expect(mockError).not.toHaveBeenCalled();
    expect(mockSuccess).toHaveBeenCalledWith("Saved", {
      theme: "colored",
      autoClose: 5000,
      position: "bottom-right",
      style: {
        background: theme.primary,
        color: "#202027",
      },
    });
  });

  it("calls toast.error with expected options", () => {
    errorToast("Failed");

    expect(mockError).toHaveBeenCalledTimes(1);
    expect(mockSuccess).not.toHaveBeenCalled();
    expect(mockError).toHaveBeenCalledWith("Failed", {
      theme: "colored",
      position: "bottom-right",
      autoClose: false,
    });
  });

  it("calls toast.error with auto-close for validation errors", () => {
    validationToast("Invalid value");

    expect(mockError).toHaveBeenCalledTimes(1);
    expect(mockError).toHaveBeenCalledWith("Invalid value", {
      theme: "colored",
      position: "bottom-right",
      autoClose: 5000,
    });
  });
});

describe("parseIntegerInRange", () => {
  it("parses integers within the range", () => {
    expect(parseIntegerInRange("50", 0, 100)).toBe(50);
    expect(parseIntegerInRange("0", 0, 100)).toBe(0);
    expect(parseIntegerInRange("100", 0, 100)).toBe(100);
  });

  it("rejects empty and whitespace-only input", () => {
    expect(parseIntegerInRange("", 0, 100)).toBeNull();
    expect(parseIntegerInRange("   ", 0, 100)).toBeNull();
  });

  it("accepts decimal spellings that evaluate to an integer", () => {
    // A number input can produce these values ("1e2", "+50", "50.0");
    // they are the integers 100, 50 and 50.
    expect(parseIntegerInRange("1e2", 0, 100)).toBe(100);
    expect(parseIntegerInRange("+50", 0, 100)).toBe(50);
    expect(parseIntegerInRange("50.0", 0, 100)).toBe(50);
    expect(parseIntegerInRange(" 50 ", 0, 100)).toBe(50);
  });

  it("rejects non-integer input", () => {
    expect(parseIntegerInRange("50.5", 0, 100)).toBeNull();
    expect(parseIntegerInRange("abc", 0, 100)).toBeNull();
    expect(parseIntegerInRange("NaN", 0, 100)).toBeNull();
    // Hex, binary and octal spellings are not decimal integers, even
    // though Number() would silently convert them.
    expect(parseIntegerInRange("0x10", 0, 100)).toBeNull();
    expect(parseIntegerInRange("0b101", 0, 100)).toBeNull();
    expect(parseIntegerInRange("0o17", 0, 100)).toBeNull();
  });

  it("rejects out-of-range values", () => {
    expect(parseIntegerInRange("-1", 0, 100)).toBeNull();
    expect(parseIntegerInRange("101", 0, 100)).toBeNull();
  });
});

describe("getFanTableRowError", () => {
  it("returns null for a valid table", () => {
    expect(
      getFanTableRowError([
        ["40", "15"],
        ["83", "50"],
        ["88", "100"],
      ]),
    ).toBeNull();
  });

  it("returns null for a single-row table", () => {
    expect(getFanTableRowError([["40", "100"]])).toBeNull();
  });

  it("flags a missing temperature", () => {
    expect(
      getFanTableRowError([
        ["40", "15"],
        ["", "50"],
      ]),
    ).toEqual({ row: 1, reason: "temperature is missing" });
  });

  it("accepts fractional temperatures supported by the backend", () => {
    expect(
      getFanTableRowError([
        ["40", "15"],
        ["83.5", "100"],
      ]),
    ).toBeNull();
  });

  it("flags an out-of-range temperature", () => {
    expect(
      getFanTableRowError([
        ["40", "15"],
        ["120", "80"],
      ]),
    ).toEqual({
      row: 1,
      reason: "temperature must be between 0 and 110",
    });
    expect(getFanTableRowError([["-5", "15"]])).toEqual({
      row: 0,
      reason: "temperature must be between 0 and 110",
    });
  });

  it("flags temperatures that do not ascend", () => {
    expect(
      getFanTableRowError([
        ["40", "15"],
        ["40", "50"],
        ["88", "100"],
      ]),
    ).toEqual({
      row: 1,
      reason: "temperature must be higher than the previous row",
    });
  });

  it("flags an out-of-range fan speed", () => {
    expect(
      getFanTableRowError([
        ["40", "15"],
        ["83", "150"],
      ]),
    ).toEqual({
      row: 1,
      reason: "fan speed must be a finite number from 0 to 100",
    });
  });

  it("flags speeds that decrease as temperature rises", () => {
    expect(
      getFanTableRowError([
        ["40", "100"],
        ["83", "50"],
        ["88", "100"],
      ]),
    ).toEqual({
      row: 1,
      reason: "fan speed must not decrease as temperature rises",
    });
  });

  it("flags a missing row instead of skipping it", () => {
    const table: [string, string][] = [
      ["40", "15"],
      ["83", "50"],
      ["88", "100"],
    ];
    delete table[1];
    expect(getFanTableRowError(table)).toEqual({
      row: 1,
      reason: "row is missing",
    });
  });

  it("accepts fractional speeds supported by the backend", () => {
    expect(
      getFanTableRowError([
        ["40", "15.5"],
        ["83", "100"],
      ]),
    ).toBeNull();
  });

  it("rejects tables that never reach emergency speed", () => {
    expect(getFanTableRowError([["30", "10"]])).toEqual({
      row: 0,
      reason: "the last entry must reach at least 85% fan speed by 90°C",
    });
    expect(
      getFanTableRowError([
        ["40", "15"],
        ["95", "100"],
      ]),
    ).toEqual({
      row: 1,
      reason: "the last entry must reach at least 85% fan speed by 90°C",
    });
  });

  it("rejects tables with more than 16 rows", () => {
    const table: [string, string][] = Array.from({ length: 17 }, (_, i) => [
      String(i),
      String(90),
    ]);
    expect(getFanTableRowError(table)).toEqual({
      row: 16,
      reason: "table must contain at most 16 rows",
    });
  });

  it("rejects empty tables and nonfinite values", () => {
    expect(getFanTableRowError([])).not.toBeNull();
    expect(getFanTableRowError([["Infinity", "50"]])).not.toBeNull();
    expect(getFanTableRowError([["50", "NaN"]])).not.toBeNull();
    expect(getFanTableRowError([["50", ""]])).not.toBeNull();
  });
});

describe("nextRequestId", () => {
  it("mints unique, prefixed request ids", () => {
    const first = nextRequestId("mode");
    const second = nextRequestId("mode");
    const rawUi = nextRequestId("rawui");

    expect(first).not.toBe(second);
    expect(first).toMatch(/^mode-/);
    expect(second).toMatch(/^mode-/);
    expect(rawUi).toMatch(/^rawui-/);
    expect(rawUi).not.toBe(first);
    expect(rawUi).not.toBe(second);
  });
});
