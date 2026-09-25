import { toast, type ToastContent } from "react-toastify";
import { theme } from "./consts";

export function successToast(content: ToastContent) {
  toast.success(content, {
    theme: "colored",
    autoClose: 5000,
    position: "bottom-right",
    style: {
      background: theme.primary,
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

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    return null;
  }

  return parsed;
}

export function getFanTableRowError(
  table: [temperature: string, speed: string][],
): { row: number; reason: string } | null {
  let previousTemperature = Number.NEGATIVE_INFINITY;

  for (let row = 0; row < table.length; row++) {
    const entry = table[row];
    if (!entry) {
      continue;
    }

    const [temperatureRaw, speedRaw] = entry;
    const trimmedTemperature = temperatureRaw.trim();

    if (trimmedTemperature === "") {
      return { row, reason: "temperature is missing" };
    }

    const temperature = Number(trimmedTemperature);
    if (!Number.isInteger(temperature)) {
      return { row, reason: "temperature must be a whole number" };
    }

    if (temperature <= previousTemperature) {
      return {
        row,
        reason: "temperature must be higher than the previous row",
      };
    }

    if (parseIntegerInRange(speedRaw, 0, 100) === null) {
      return {
        row,
        reason: "fan speed must be a whole number from 0 to 100",
      };
    }

    previousTemperature = temperature;
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
