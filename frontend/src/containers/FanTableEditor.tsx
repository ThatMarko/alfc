import styled from "@emotion/styled";
import {
  faFan,
  faMinusCircle,
  faPlusCircle,
  faThermometerHalf,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { FanTableItems } from "./FanTable";

type Props = {
  label: string;
  disabled?: boolean;
  onChange: (nextCurvePoints: FanTableItems) => void;
  value: FanTableItems;
};

const StyledInput = styled.input`
  width: 4.25rem;
`;

const StyledButton = styled.button`
  width: 24px;
  height: 24px;
  padding: 0;
`;

export function FanTableEditor({
  label,
  disabled = false,
  onChange,
  value,
}: Props) {
  const inputs = value.map((tableItem, idx) => {
    return (
      <tr key={idx}>
        <td>
          <StyledInput
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
              const nextValue = structuredClone(value);
              nextValue[idx] = [event.target.value, tableItem[1]];
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
              const nextValue = structuredClone(value);
              nextValue[idx] = [tableItem[0], event.target.value];
              onChange(nextValue);
            }}
            value={tableItem[1]}
          />
        </td>
        <td>
          <StyledButton
            type="button"
            aria-label={`Add ${label} row before row ${idx + 1}`}
            disabled={disabled || Number(tableItem[0]) <= 0}
            onClick={() => {
              const nextValue = structuredClone(value);
              const currentTemperature = Number(tableItem[0]);
              const previousTemperature =
                idx > 0 ? Number(value[idx - 1]?.[0]) : 0;
              const temperature =
                Number.isFinite(currentTemperature) &&
                Number.isFinite(previousTemperature)
                  ? Math.max(0, (currentTemperature + previousTemperature) / 2)
                  : 0;
              const currentSpeed = Number(tableItem[1]);
              const percentage = Number.isFinite(currentSpeed)
                ? Math.max(0, Math.min(100, currentSpeed))
                : 0;
              nextValue.splice(idx, 0, [
                String(temperature),
                String(percentage),
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
              const nextValue = structuredClone(value);
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
              <span className="sr-only">Temperature</span>
            </th>
            <th aria-label="Fan Speed">
              <FontAwesomeIcon icon={faFan} aria-hidden="true" />
              <span className="sr-only">Fan Speed</span>
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
          onChange([...value, [String(temperature), last?.[1] ?? "0"]]);
        }}
      >
        Add row
      </button>
    </div>
  );
}
