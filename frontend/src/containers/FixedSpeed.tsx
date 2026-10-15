import React, { useRef } from "react";
import { MessageToServerKind } from "../../../common/types";
import { StyledApplyButton } from "../components/StyledApplyButton";
import {
  useBackendCommand,
  useBackendDraft,
  useWebSocket,
} from "../utils/useWebSocket";
import { parseIntegerInRange, validationToast } from "../utils/misc";

export function FixedSpeed({ disabled }: { disabled: boolean }) {
  const submitRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { isConnected, state } = useWebSocket();
  const [fixedPercentage, setFixedPercentage] = useBackendDraft(
    String(state?.fixedPercentage ?? 0),
  );
  const { isPending: isApplying, runCommand } = useBackendCommand();
  if (!state) return null;
  const isDisabled = disabled || !isConnected;

  const onSubmit: React.FormEventHandler = (event) => {
    event.preventDefault();
    if (isDisabled || isApplying) return;
    submitRef.current?.focus();
    const percentage = parseIntegerInRange(fixedPercentage, 0, 100);
    if (percentage === null) {
      inputRef.current?.focus();
      validationToast("Fan speed must be a whole number from 0 to 100.");
      return;
    }
    void runCommand({
      kind: MessageToServerKind.FixedPercentage,
      data: percentage,
    });
  };

  return (
    <form
      id="fixed-speed-preset"
      tabIndex={-1}
      className="panel"
      onSubmit={onSubmit}
      aria-label="Fixed speed preset"
    >
      <div className="panel-header">
        <h2>Fixed speed</h2>
        <span className="status-pill">
          {state.doFixedSpeed ? "Active mode" : "Stored preset"}
        </span>
      </div>
      <p className="section-description">
        Use one fan target independent of the temperature curves.
      </p>
      <label className="field" style={{ marginTop: 18 }}>
        Fan target (%)
        <input
          ref={inputRef}
          type="number"
          name="percentage"
          aria-label="Fixed fan speed percentage"
          disabled={isDisabled || isApplying}
          min={0}
          max={100}
          required
          step={1}
          onChange={(event) => setFixedPercentage(event.target.value)}
          value={fixedPercentage}
        />
      </label>
      <div className="form-actions">
        <span className="helper-text">
          {state.doFixedSpeed
            ? "Applies to both fans after confirmation."
            : "Save a preset here, then choose Fixed speed to activate it."}
        </span>
        <StyledApplyButton
          ref={submitRef}
          type="submit"
          disabled={isDisabled || isApplying}
        >
          {isApplying ? "Applying…" : "Apply"}
        </StyledApplyButton>
      </div>
    </form>
  );
}
