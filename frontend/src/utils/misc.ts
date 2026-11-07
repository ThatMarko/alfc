import {
  MAX_EMERGENCY_FAN_TEMP,
  MAX_FAN_TABLE_ENTRIES,
  MIN_EMERGENCY_FAN_SPEED,
} from "../../../common/validation";
import { toast, type ToastContent } from "react-toastify/unstyled";
import { theme } from "./consts";

export function successToast(content: ToastContent) {
  toast.success(content, {
    theme: "colored",
    autoClose: 5000,
    position: "bottom-right",
    style: {
      background: theme.primary,
      color: "#202027",
    },
  });
}

export function errorToast(content: ToastContent) {
  toast.error(content, {
    theme: "colored",
    position: "bottom-right",
    autoClose: false,
  });
}

// Validation errors are explained by the input they came from,
// so they should disappear on their own instead of stacking up.
export function validationToast(content: ToastContent) {
  toast.error(content, {
    theme: "colored",
    position: "bottom-right",
    autoClose: 5000,
  });
}

export function parseIntegerInRange(
  value: string,
  minimum: number,
  maximum: number,
): number | null {
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }

  // Accept the decimal forms a number input can produce ("1e2", "+50",
  // "50.0") when they evaluate to an integer, but reject hex, binary and
  // octal ("0x10", "0b101", "0o17") that Number() would silently convert.
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    return null;
  }

  return parsed;
}

export function getFanTableRowError(
  table: [temperature: string, speed: string][],
): { row: number; reason: string } | null {
  if (table.length === 0)
    return { row: 0, reason: "table must contain at least one row" };
  let previousTemperature = Number.NEGATIVE_INFINITY;
  let previousSpeed = Number.NEGATIVE_INFINITY;

  for (let row = 0; row < table.length; row++) {
    const entry = table[row];
    // A sparse row (a hole in the array) is a missing row, not an empty
    // one: skipping it would let a malformed table pass validation.
    if (!entry) {
      return { row, reason: "row is missing" };
    }

    const [temperatureRaw, speedRaw] = entry;
    const trimmedTemperature = temperatureRaw.trim();

    if (trimmedTemperature === "") {
      return { row, reason: "temperature is missing" };
    }

    const temperature = Number(trimmedTemperature);
    if (!Number.isFinite(temperature)) {
      return { row, reason: "temperature must be a finite number" };
    }

    if (temperature < 0 || temperature > 110) {
      return {
        row,
        reason: "temperature must be between 0 and 110",
      };
    }

    if (temperature <= previousTemperature) {
      return {
        row,
        reason: "temperature must be higher than the previous row",
      };
    }

    const speed = speedRaw.trim() === "" ? NaN : Number(speedRaw);
    if (!Number.isFinite(speed) || speed < 0 || speed > 100) {
      return {
        row,
        reason: "fan speed must be a finite number from 0 to 100",
      };
    }

    // A curve that spins the fans down as the machine gets hotter is a
    // misconfiguration the controller would faithfully obey.
    if (speed < previousSpeed) {
      return {
        row,
        reason: "fan speed must not decrease as temperature rises",
      };
    }

    previousTemperature = temperature;
    previousSpeed = speed;
  }

  // Whole-table rules, checked here because this validator only runs on
  // submit — it never fires while the user is still building the curve.
  if (table.length > MAX_FAN_TABLE_ENTRIES) {
    return {
      row: MAX_FAN_TABLE_ENTRIES,
      reason: `table must contain at most ${MAX_FAN_TABLE_ENTRIES} rows`,
    };
  }

  // The last entry is the fastest the curve can ever command. A curve
  // that never reaches a high speed while the machine is hot cannot cool
  // the hardware at all.
  if (
    previousTemperature > MAX_EMERGENCY_FAN_TEMP ||
    previousSpeed < MIN_EMERGENCY_FAN_SPEED
  ) {
    return {
      row: table.length - 1,
      reason: `the last entry must reach at least ${MIN_EMERGENCY_FAN_SPEED}% fan speed by ${MAX_EMERGENCY_FAN_TEMP}°C`,
    };
  }

  return null;
}

let requestSerial = 0;

// The protocol has no server-generated correlation key, so each request
// mints a unique id that the server echoes back in its response.
export function nextRequestId(prefix: string): string {
  requestSerial += 1;
  return `${prefix}-${requestSerial}`;
}
