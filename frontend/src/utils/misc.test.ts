const { mockSuccess, mockError } = vi.hoisted(() => ({
  mockSuccess: vi.fn(),
  mockError: vi.fn(),
}));

vi.mock("react-toastify", () => ({
  toast: {
    success: mockSuccess,
    error: mockError,
  },
}));

import { theme } from "./consts";
import {
  errorToast,
  getFanTableRowError,
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

  it("rejects non-integer input", () => {
    expect(parseIntegerInRange("50.5", 0, 100)).toBeNull();
    expect(parseIntegerInRange("abc", 0, 100)).toBeNull();
    expect(parseIntegerInRange("NaN", 0, 100)).toBeNull();
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
    expect(getFanTableRowError([["40", "15"]])).toBeNull();
  });

  it("flags a missing temperature", () => {
    expect(
      getFanTableRowError([
        ["40", "15"],
        ["", "50"],
      ]),
    ).toEqual({ row: 1, reason: "temperature is missing" });
  });

  it("flags a non-whole temperature", () => {
    expect(
      getFanTableRowError([
        ["40", "15"],
        ["83.5", "50"],
      ]),
    ).toEqual({ row: 1, reason: "temperature must be a whole number" });
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
      reason: "fan speed must be a whole number from 0 to 100",
    });
  });

  it("flags a non-whole fan speed", () => {
    expect(
      getFanTableRowError([
        ["40", "15"],
        ["83", "50.5"],
      ]),
    ).toEqual({
      row: 1,
      reason: "fan speed must be a whole number from 0 to 100",
    });
  });
});
