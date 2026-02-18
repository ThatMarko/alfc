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
  onChange: (nextCurvePoints: FanTableItems) => void;
  value: FanTableItems;
};

const StyledInput = styled.input`
  width: 3rem;
`;

const StyledButton = styled.button`
  width: 24px;
  height: 24px;
  padding: 0;
`;

export function FanTableEditor({ onChange, value }: Props) {
  const inputs = value.map((tableItem, idx) => {
    return (
      <tr key={idx}>
        <td>
          <StyledInput
            type="number"
            name="temperature"
            aria-label={`Temperature for row ${idx + 1}`}
            min={40}
            max={100}
            maxLength={3}
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
            aria-label={`Fan speed for row ${idx + 1}`}
            min={0}
            max={100}
            maxLength={3}
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
            aria-label={`Add row before row ${idx + 1}`}
            onClick={() => {
              const nextValue = structuredClone(value);
              let temperature = parseInt(tableItem[0], 10) - 1;
              let percentage = parseInt(tableItem[1], 10) - 1;
              if (temperature < 40) {
                temperature = 40;
              }
              if (percentage < 0) {
                percentage = 0;
              }
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
            aria-label={`Remove row ${idx + 1}`}
            disabled={value.length === 1}
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
      <table>
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
    </div>
  );
}
