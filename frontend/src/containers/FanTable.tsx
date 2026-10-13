import styled from "@emotion/styled";
import React, { useEffect, useRef, useState } from "react";
import { StyledApplyButton } from "../components/StyledApplyButton";
import { StyledArea } from "../components/StyledArea";
import { useWebSocket } from "../utils/useWebSocket";
import {
  getFanTableRowError,
  nextRequestId,
  validationToast,
} from "../utils/misc";
import { FanTableEditor } from "./FanTableEditor";
import { Status } from "./Status";
import { disabledFormStyle, enabledFormStyle } from "./styles/misc";

export type FanTableItems = [temperature: string, speed: string][];

const StyledForm = styled.form<{ disabled: boolean }>`
  position: relative;

  text-align: center;
  padding: 0 32px;
  margin: 32px;

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
  const pendingRequestIdRef = useRef<string | null>(null);

  const [cpuTable, setCPUTable] = useState<FanTableItems>([]);
  const [gpuTable, setGPUTable] = useState<FanTableItems>([]);
  const [isApplying, setIsApplying] = useState(false);

  const { isConnected, sendJsonMessage, lastJsonMessage } = useWebSocket();

  useEffect(() => {
    const { kind, data, requestId } = lastJsonMessage;
    if (kind === "state") {
      setCPUTable(
        data.cpuFanTable.map(([temperature, speed]) => [
          temperature.toString(),
          speed.toString(),
        ]),
      );
      setGPUTable(
        data.gpuFanTable.map(([temperature, speed]) => [
          temperature.toString(),
          speed.toString(),
        ]),
      );
    } else if (
      (kind === "success" || kind === "error") &&
      pendingRequestIdRef.current !== null &&
      requestId === pendingRequestIdRef.current
    ) {
      pendingRequestIdRef.current = null;
      setIsApplying(false);
    }
  }, [lastJsonMessage]);

  if (!isConnected) {
    return null;
  }

  const onSubmit: React.FormEventHandler = (event) => {
    event.preventDefault();
    if (disabled || isApplying) {
      return;
    }
    submitRef.current?.focus();

    const cpuInvalidRow = getFanTableRowError(cpuTable);
    const gpuInvalidRow = getFanTableRowError(gpuTable);
    const tableName = cpuInvalidRow ? "CPU" : "GPU";
    const invalidRow = cpuInvalidRow ?? gpuInvalidRow;

    if (invalidRow) {
      validationToast(
        `Invalid ${tableName} fan table (row ${invalidRow.row + 1}): ${invalidRow.reason}.`,
      );
      return;
    }

    const requestId = nextRequestId("fantable");
    pendingRequestIdRef.current = requestId;
    setIsApplying(true);
    sendJsonMessage({
      kind: "fantable",
      requestId,
      data: {
        cpu: cpuTable.map((entry) => [
          parseInt(entry[0], 10),
          parseInt(entry[1], 10),
        ]),
        gpu: gpuTable.map((entry) => [
          parseInt(entry[0], 10),
          parseInt(entry[1], 10),
        ]),
      },
    });
  };

  return (
    <div style={{ textAlign: "center" }}>
      <StyledForm disabled={disabled} onSubmit={onSubmit}>
        <div style={{ display: "flex" }}>
          <StyledArea>
            <h2 style={{ marginTop: 0 }}>CPU</h2>
            <FanTableEditor
              disabled={disabled}
              onChange={(nextCurvePoints) => setCPUTable(nextCurvePoints)}
              value={cpuTable}
            />
          </StyledArea>
          <StyledArea style={{ marginRight: 0 }}>
            <h2 style={{ marginTop: 0 }}>GPU</h2>
            <FanTableEditor
              disabled={disabled}
              onChange={(nextCurvePoints) => setGPUTable(nextCurvePoints)}
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
