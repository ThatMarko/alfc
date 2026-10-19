import styled from "@emotion/styled";
import {
  faFan,
  faMinusCircle,
  faPlusCircle,
  faThermometerHalf,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useRef } from "react";
import type { FanTableItems } from "./FanTable";
import { fanTableInsertionTemperature } from "../utils/fanTable";

type Props = {
  label: string;
  disabled?: boolean;
  onChange: (nextCurvePoints: FanTableItems) => void;
  value: FanTableItems;
};

const StyledInput = styled.input`
  width: 100%;
`;

const StyledButton = styled.button`
  width: 28px;
  height: 30px;
  min-height: 30px;
  padding: 0;
`;

export function FanTableEditor({
  label,
  disabled = false,
  onChange,
  value,
}: Props) {
  const temperatureInputsRef = useRef(new Map<string, HTMLInputElement>());
  const inputs = value.map((tableItem, idx) => {
    const insertionTemperature = fanTableInsertionTemperature(value, idx);
    return (
      <tr key={tableItem[2]}>
        <td>
          <StyledInput
            ref={(input) => {
              if (input) temperatureInputsRef.current.set(tableItem[2], input);
              else temperatureInputsRef.current.delete(tableItem[2]);
            }}
            type="number"
            name="temperature"
            aria-label={`${label} temperature for row ${idx + 1}`}
            disabled={disabled}
            min={0}
            max={110}
            step="any"
            required
            size={4}
            onChange={(event) => {
              const nextValue = value.slice();
              nextValue[idx] = [event.target.value, tableItem[1], tableItem[2]];
              onChange(nextValue);
            }}
            value={tableItem[0]}
          />
        </td>
        <td>
          <StyledInput
            type="number"
            name="percentage"
            aria-label={`${label} fan speed for row ${idx + 1}`}
            disabled={disabled}
            min={0}
            max={100}
            step="any"
            required
            size={4}
            onChange={(event) => {
              const nextValue = value.slice();
              nextValue[idx] = [tableItem[0], event.target.value, tableItem[2]];
              onChange(nextValue);
            }}
            value={tableItem[1]}
          />
        </td>
        <td>
          <StyledButton
            type="button"
            aria-label={`Add ${label} row before row ${idx + 1}`}
            disabled={disabled || insertionTemperature === null}
            onClick={() => {
              const nextValue = value.slice();
              if (insertionTemperature === null) return;
              const currentSpeed = Number(tableItem[1]);
              const percentage = Number.isFinite(currentSpeed)
                ? Math.max(0, Math.min(100, currentSpeed))
                : 0;
              nextValue.splice(idx, 0, [
                String(insertionTemperature),
                String(percentage),
                crypto.randomUUID(),
              ]);
              onChange(nextValue);
            }}
          >
            <FontAwesomeIcon icon={faPlusCircle} aria-hidden="true" />
          </StyledButton>
        </td>
        <td>
          <StyledButton
            type="button"
            aria-label={`Remove ${label} row ${idx + 1}`}
            disabled={disabled || value.length === 1}
            style={
              value.length === 1
                ? {
                    cursor: "default",
                    opacity: "0.4",
                  }
                : {}
            }
            onClick={() => {
              // Move focus before removing its button. The neighbouring row
              // keeps its stable key when its displayed row number changes.
              const nextFocusId = value[idx + 1]?.[2] ?? value[idx - 1]?.[2];
              if (nextFocusId !== undefined)
                temperatureInputsRef.current.get(nextFocusId)?.focus();
              const nextValue = value.slice();
              nextValue.splice(idx, 1);
              onChange(nextValue);
            }}
          >
            <FontAwesomeIcon icon={faMinusCircle} aria-hidden="true" />
          </StyledButton>
        </td>
      </tr>
    );
  });

  return (
    <div>
      <table aria-label={`${label} fan curve`}>
        <thead>
          <tr>
            <th aria-label="Temperature">
              <FontAwesomeIcon icon={faThermometerHalf} aria-hidden="true" />
              <span> °C</span>
            </th>
            <th aria-label="Fan Speed">
              <FontAwesomeIcon icon={faFan} aria-hidden="true" />
              <span> %</span>
            </th>
            <th aria-label="Add Row" />
            <th aria-label="Remove Row" />
          </tr>
        </thead>
        <tbody>{inputs}</tbody>
      </table>
      <button
        type="button"
        aria-label={`Append ${label} fan curve row`}
        disabled={disabled || Number(value.at(-1)?.[0] ?? 0) >= 110}
        onClick={() => {
          const last = value.at(-1);
          const previousTemperature = Number(last?.[0] ?? 0);
          const temperature = Number.isFinite(previousTemperature)
            ? Math.min(110, previousTemperature + 1)
            : 0;
          onChange([
            ...value,
            [String(temperature), last?.[1] ?? "0", crypto.randomUUID()],
          ]);
        }}
      >
        Add row
      </button>
    </div>
  );
}
