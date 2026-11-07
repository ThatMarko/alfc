import React, { useRef } from "react";
import { MessageToServerKind } from "../../../common/types";
import { StyledApplyButton } from "../components/StyledApplyButton";
import {
  useBackendCommand,
  useBackendDraft,
  useWebSocket,
} from "../utils/useWebSocket";
import { getFanTableRowError, validationToast } from "../utils/misc";
import { FanTableEditor } from "./FanTableEditor";

export type FanTableItems = [temperature: string, speed: string, id: string][];

function toItems(table: readonly (readonly [number, number])[]): FanTableItems {
  return table.map(
    ([temperature, speed]) =>
      [
        String(temperature),
        String(speed),
        String(temperature),
      ] as FanTableItems[number],
  );
}

function draftMatchesState(
  draft: FanTableItems,
  table: readonly (readonly [number, number])[],
): boolean {
  return (
    draft.length === table.length &&
    draft.every(
      ([temperature, speed], index) =>
        Number(temperature) === table[index]?.[0] &&
        Number(speed) === table[index]?.[1],
    )
  );
}

export function FanTable({ disabled }: { disabled: boolean }) {
  const submitRef = useRef<HTMLButtonElement>(null);
  const { isConnected, state } = useWebSocket();
  const { isPending: isApplying, runCommand } = useBackendCommand();
  const [cpuTable, setCPUTable] = useBackendDraft(
    toItems(state?.cpuFanTable ?? []),
  );
  const [gpuTable, setGPUTable] = useBackendDraft(
    toItems(state?.gpuFanTable ?? []),
  );

  if (!state) return null;
  const isDisabled = disabled || !isConnected;
  const hasUnsavedChanges =
    !draftMatchesState(cpuTable, state.cpuFanTable) ||
    !draftMatchesState(gpuTable, state.gpuFanTable);
  const onReset = () => {
    if (isDisabled || isApplying || !hasUnsavedChanges) return;
    setCPUTable(toItems(state.cpuFanTable));
    setGPUTable(toItems(state.gpuFanTable));
  };
  const onSubmit: React.FormEventHandler = (event) => {
    event.preventDefault();
    if (isDisabled || isApplying) return;
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
        "Invalid " +
          tableName +
          " fan table (row " +
          (invalidRow.row + 1) +
          "): " +
          invalidRow.reason +
          ".",
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
    <form
      id="automatic-fan-curves"
      tabIndex={-1}
      className="panel"
      onSubmit={onSubmit}
      aria-label="Automatic fan curves"
    >
      <div className="panel-header">
        <h2>Automatic fan curves</h2>
        <span className="status-pill">
          {state.doFixedSpeed ? "Stored preset" : "Active mode"}
        </span>
      </div>
      <p className="section-description">
        Set temperature thresholds and fan targets. Both fans use the higher CPU
        or GPU target; values between thresholds use the previous step.
      </p>
      <div className="curve-editors">
        <section aria-label="CPU fan curve editor">
          <h3>CPU</h3>
          <FanTableEditor
            disabled={isDisabled || isApplying}
            label="CPU"
            onChange={setCPUTable}
            value={cpuTable}
          />
        </section>
        <section aria-label="GPU fan curve editor">
          <h3>GPU</h3>
          <FanTableEditor
            disabled={isDisabled || isApplying}
            label="GPU"
            onChange={setGPUTable}
            value={gpuTable}
          />
        </section>
      </div>
      <div className="form-actions">
        <span className="helper-text">
          {state.doFixedSpeed
            ? "You can save curves now. They take effect in automatic mode."
            : "Accepted changes update the automatic fan policy."}
        </span>
        <button
          type="button"
          disabled={isDisabled || isApplying || !hasUnsavedChanges}
          onClick={onReset}
        >
          Reload
        </button>
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
