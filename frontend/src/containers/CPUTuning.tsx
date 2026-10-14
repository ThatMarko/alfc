import styled from "@emotion/styled";
import React from "react";
import { MessageToServerKind } from "../../../common/types";
import { InfoTooltip } from "../components/InfoTooltip";
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
  const { isConnected, state } = useWebSocket();
  const isCpuTuningAvailable = state?.isCpuTuningAvailable === true;
  const { isPending: isApplying, runCommand } = useBackendCommand();
  const [pl1, setPL1] = useBackendDraft(String(state?.pl1 ?? 0));
  const [pl2, setPL2] = useBackendDraft(String(state?.pl2 ?? 0));

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
        <InfoTooltip label="About CPU tuning">
          The backend did not detect a supported CPU tuning interface.
          Availability depends on your hardware, drivers, and operating system.
        </InfoTooltip>
      </h2>
    </>
  ) : (
    <>
      <h2 style={{ marginBottom: 16 }}>
        CPU power limits{" "}
        <InfoTooltip label="About CPU tuning">
          The ECO profile for the i7-10875H in the Gigabyte Control Center is
          38/107, Boost is 62/107.
          <br />
          Limits are applied and confirmed by the backend. Supported values are
          0 to 200 watts.
        </InfoTooltip>
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
              onChange={(event) => setPL1(event.target.value)}
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
              onChange={(event) => setPL2(event.target.value)}
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
