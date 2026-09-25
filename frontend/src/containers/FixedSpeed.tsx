import styled from "@emotion/styled";
import React, { useEffect, useRef, useState } from "react";
import { StyledApplyButton } from "../components/StyledApplyButton";
import { useWebSocket } from "../utils/useWebSocket";
import { parseIntegerInRange, validationToast } from "../utils/misc";
import { disabledFormStyle, enabledFormStyle } from "./styles/misc";

const StyledForm = styled.form<{ disabled: boolean }>`
  position: relative;
  display: flex;
  align-items: center;

  text-align: center;
  padding: 0 32px;
  margin: 32px;

  ${({ disabled }) => enabledFormStyle(disabled)}
  ${({ disabled }) => disabledFormStyle(disabled)}
`;

const StyledInput = styled.input`
  width: 3rem;
`;

export function FixedSpeed({ disabled }: { disabled: boolean }) {
  const submitRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [fixedPercentage, setFixedPercentage] = useState("0");

  const { isConnected, sendJsonMessage, lastJsonMessage } = useWebSocket();

  useEffect(() => {
    const { kind, data } = lastJsonMessage;
    if (kind === "state") {
      setFixedPercentage(data.fixedPercentage.toString());
    }
  }, [lastJsonMessage]);

  if (!isConnected) {
    return null;
  }

  const onSubmit: React.FormEventHandler = (event) => {
    event.preventDefault();
    submitRef.current?.focus();

    const percentage = parseIntegerInRange(fixedPercentage, 0, 100);
    if (percentage === null) {
      inputRef.current?.focus();
      validationToast("Fan speed must be a whole number from 0 to 100.");
      return;
    }

    sendJsonMessage({
      kind: "fixedpercentage",
      data: percentage,
    });
  };

  return (
    <StyledForm disabled={disabled} onSubmit={onSubmit}>
      <div>
        <h2>Fan Speed</h2>
        <StyledInput
          ref={inputRef}
          type="number"
          name="percentage"
          aria-label="Fixed fan speed percentage"
          min={0}
          max={100}
          maxLength={3}
          size={4}
          onChange={(event) => {
            setFixedPercentage(event.target.value);
          }}
          value={fixedPercentage}
        />
        <br />
        <StyledApplyButton
          ref={submitRef}
          type="submit"
          style={{ marginTop: 16 }}
        >
          Apply
        </StyledApplyButton>
      </div>
    </StyledForm>
  );
}
