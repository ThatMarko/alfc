import styled from "@emotion/styled";
import { faInfoCircle } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import React, { useRef } from "react";
import { MessageToServerKind } from "../../../common/types";
import { SimpleTooltip } from "../components/SimpleTooltip";
import { StyledApplyButton } from "../components/StyledApplyButton";
import { StyledArea } from "../components/StyledArea";
import { parseIntegerInRange, validationToast } from "../utils/misc";
import {
  useBackendCommand,
  useBackendDraft,
  useWebSocket,
} from "../utils/useWebSocket";

const StyledInput = styled.input`
  width: 56px;
`;

const StyledLabel = styled.label`
  display: inline-flex;
  align-items: center;
`;

export function CPUTuning() {
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const { isConnected, state } = useWebSocket();
  const isCpuTuningAvailable = state?.isCpuTuningAvailable === true;
  const { isPending: isApplying, runCommand } = useBackendCommand();
  const [limits, setLimits] = useBackendDraft({
    pl1: String(state?.pl1 ?? 0),
    pl2: String(state?.pl2 ?? 0),
  });
  const { pl1, pl2 } = limits;

  if (!isConnected) {
    return null;
  }

  const onSubmit: React.FormEventHandler = (event) => {
    event.preventDefault();
    if (!isCpuTuningAvailable || isApplying) return;
    const nextPl1 = parseIntegerInRange(pl1, 0, 200);
    const nextPl2 = parseIntegerInRange(pl2, 0, 200);
    if (nextPl1 === null || nextPl2 === null) {
      validationToast("Power limits must be whole numbers from 0 to 200.");
      return;
    }
    void runCommand({
      kind: MessageToServerKind.Tune,
      data: { pl1: nextPl1, pl2: nextPl2 },
    });
  };

  const content = !isCpuTuningAvailable ? (
    <>
      <h2>
        CPU Tuning is not available.{" "}
        <span ref={tooltipRef} tabIndex={0} aria-label="About CPU tuning">
          <FontAwesomeIcon icon={faInfoCircle} />
        </span>
        <SimpleTooltip target={tooltipRef}>
          The backend did not detect a supported CPU tuning interface.
          Availability depends on your hardware, drivers, and operating system.
        </SimpleTooltip>
      </h2>
    </>
  ) : (
    <>
      <h2 style={{ marginBottom: 16 }}>
        CPU power limits{" "}
        <span ref={tooltipRef} tabIndex={0} aria-label="About CPU tuning">
          <FontAwesomeIcon icon={faInfoCircle} />
        </span>
        <SimpleTooltip target={tooltipRef}>
          The ECO profile for the i7-10875H in the Gigabyte Control Center is
          38/107, Boost is 62/107.
          <br />
          Limits are applied and confirmed by the backend. Supported values are
          0 to 200 watts.
        </SimpleTooltip>
      </h2>
      <form onSubmit={onSubmit}>
        <fieldset
          disabled={isApplying}
          style={{ border: 0, padding: 0, margin: 0 }}
        >
          <StyledLabel>
            PL1
            <StyledInput
              size={4}
              type="number"
              min={0}
              max={200}
              aria-label="PL1 power limit in watts"
              required
              step={1}
              onChange={(event) =>
                setLimits((current) => ({
                  ...current,
                  pl1: event.target.value,
                }))
              }
              value={pl1}
            />
          </StyledLabel>
          <br />
          <StyledLabel>
            PL2
            <StyledInput
              size={4}
              type="number"
              min={0}
              max={200}
              aria-label="PL2 power limit in watts"
              required
              step={1}
              onChange={(event) =>
                setLimits((current) => ({
                  ...current,
                  pl2: event.target.value,
                }))
              }
              value={pl2}
            />
          </StyledLabel>
          <br />
          <StyledApplyButton
            disabled={isApplying}
            type="submit"
            style={{ marginTop: 16 }}
          >
            Apply
          </StyledApplyButton>
        </fieldset>
      </form>
    </>
  );

  return <StyledArea style={{ marginTop: 32 }}>{content}</StyledArea>;
}
