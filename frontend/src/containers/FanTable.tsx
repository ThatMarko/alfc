import styled from "@emotion/styled";
import React, { useRef } from "react";
import { MessageToServerKind } from "../../../common/types";
import { StyledApplyButton } from "../components/StyledApplyButton";
import { StyledArea } from "../components/StyledArea";
import {
  useBackendCommand,
  useBackendDraft,
  useWebSocket,
} from "../utils/useWebSocket";
import { getFanTableRowError, validationToast } from "../utils/misc";
import { FanTableEditor } from "./FanTableEditor";
import { Status } from "./Status";
import { disabledFormStyle, enabledFormStyle } from "./styles/misc";

export type FanTableItems = [temperature: string, speed: string, id: string][];

const StyledForm = styled.form<{ disabled: boolean }>`
  position: relative;

  text-align: center;
  padding: 0 16px;
  margin: 16px;

  ${({ disabled }) => enabledFormStyle(disabled)}
  ${({ disabled }) => disabledFormStyle(disabled)}
`;

export function FanTable({
  disabled,
  statusDisabled = disabled,
}: {
  disabled: boolean;
  statusDisabled?: boolean;
}) {
  const submitRef = useRef<HTMLButtonElement>(null);
  const { isConnected, state } = useWebSocket();
  const { isPending: isApplying, runCommand } = useBackendCommand();
  const [cpuTable, setCPUTable] = useBackendDraft(
    (state?.cpuFanTable ?? []).map(
      ([temperature, speed]) =>
        // Valid backend temperatures are unique. Keep this initial identity
        // when editing a row so insertion/removal cannot move input focus.
        [
          String(temperature),
          String(speed),
          String(temperature),
        ] as FanTableItems[number],
    ),
  );
  const [gpuTable, setGPUTable] = useBackendDraft(
    (state?.gpuFanTable ?? []).map(
      ([temperature, speed]) =>
        [
          String(temperature),
          String(speed),
          String(temperature),
        ] as FanTableItems[number],
    ),
  );

  if (!isConnected) {
    return null;
  }

  const onSubmit: React.FormEventHandler = (event) => {
    event.preventDefault();
    if (disabled || isApplying) {
      return;
    }
    submitRef.current?.focus();

    const cpuInvalidRow = getFanTableRowError(
      cpuTable.map(([temperature, speed]) => [temperature, speed]),
    );
    const gpuInvalidRow = getFanTableRowError(
      gpuTable.map(([temperature, speed]) => [temperature, speed]),
    );
    const tableName = cpuInvalidRow ? "CPU" : "GPU";
    const invalidRow = cpuInvalidRow ?? gpuInvalidRow;

    if (invalidRow) {
      validationToast(
        `Invalid ${tableName} fan table (row ${invalidRow.row + 1}): ${invalidRow.reason}.`,
      );
      return;
    }

    void runCommand({
      kind: MessageToServerKind.FanTable,
      data: {
        cpu: cpuTable.map(([temperature, speed]) => [
          Number(temperature),
          Number(speed),
        ]),
        gpu: gpuTable.map(([temperature, speed]) => [
          Number(temperature),
          Number(speed),
        ]),
      },
    });
  };

  return (
    <div style={{ textAlign: "center" }}>
      <StyledForm disabled={disabled} onSubmit={onSubmit}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          <StyledArea>
            <h2 style={{ marginTop: 0 }}>CPU</h2>
            <FanTableEditor
              disabled={disabled || isApplying}
              label="CPU"
              onChange={setCPUTable}
              value={cpuTable}
            />
          </StyledArea>
          <StyledArea style={{ marginRight: 0 }}>
            <h2 style={{ marginTop: 0 }}>GPU</h2>
            <FanTableEditor
              disabled={disabled || isApplying}
              label="GPU"
              onChange={setGPUTable}
              value={gpuTable}
            />
          </StyledArea>
        </div>
        <StyledApplyButton
          ref={submitRef}
          type="submit"
          disabled={disabled || isApplying}
          style={{ marginBottom: 16 }}
        >
          Apply
        </StyledApplyButton>
      </StyledForm>
      <Status disabled={statusDisabled} />
    </div>
  );
}
