import React from "react";
import { MessageToServerKind } from "../../../common/types";
import {
  MAX_PL1_WATTS,
  MAX_PL2_WATTS,
  MIN_POWER_LIMIT_WATTS,
} from "../../../common/validation";
import { InfoTooltip } from "../components/InfoTooltip";
import { StyledApplyButton } from "../components/StyledApplyButton";
import { parseIntegerInRange, validationToast } from "../utils/misc";
import {
  useBackendCommand,
  useBackendDraft,
  useWebSocket,
} from "../utils/useWebSocket";

export function CPUTuning() {
  const { isConnected, state } = useWebSocket();
  const isCpuTuningAvailable = state?.isCpuTuningAvailable === true;
  const { isPending: isApplying, runCommand } = useBackendCommand();
  const [pl1, setPL1] = useBackendDraft(String(state?.pl1 ?? 0));
  const [pl2, setPL2] = useBackendDraft(String(state?.pl2 ?? 0));
  if (!state) return null;

  const onSubmit: React.FormEventHandler = (event) => {
    event.preventDefault();
    if (!isConnected || !isCpuTuningAvailable || isApplying) return;
    const nextPl1 = parseIntegerInRange(
      pl1,
      MIN_POWER_LIMIT_WATTS,
      MAX_PL1_WATTS,
    );
    const nextPl2 = parseIntegerInRange(
      pl2,
      MIN_POWER_LIMIT_WATTS,
      MAX_PL2_WATTS,
    );
    if (nextPl1 === null || nextPl2 === null || nextPl1 > nextPl2) {
      validationToast(
        `PL1 must be a whole number from ${MIN_POWER_LIMIT_WATTS} to ${MAX_PL1_WATTS} watts and PL2 from ${MIN_POWER_LIMIT_WATTS} to ${MAX_PL2_WATTS} watts, with PL1 no higher than PL2.`,
      );
      return;
    }
    void runCommand({
      kind: MessageToServerKind.Tune,
      data: { pl1: nextPl1, pl2: nextPl2 },
    });
  };

  return (
    <section className="panel" aria-label="CPU power limits">
      <div className="panel-header">
        <h2>
          CPU power limits{" "}
          <InfoTooltip label="About CPU tuning">
            PL1 is the sustained power limit; PL2 is the short-term limit. The
            backend accepts PL1 from {MIN_POWER_LIMIT_WATTS} to {MAX_PL1_WATTS}{" "}
            watts and PL2 from {MIN_POWER_LIMIT_WATTS} to {MAX_PL2_WATTS} watts,
            with PL1 no higher than PL2. Those bounds are conservative policy,
            not a hardware rating. Choose limits appropriate for your CPU.
          </InfoTooltip>
        </h2>
      </div>
      {!isCpuTuningAvailable ? (
        <p className="capability-unavailable">
          CPU Tuning is not available. A supported power-limit interface was not
          detected.
        </p>
      ) : (
        <>
          <p className="section-description">
            Manage sustained and short-term CPU power.
          </p>
          <form onSubmit={onSubmit}>
            <fieldset disabled={!isConnected || isApplying}>
              <div className="fields-row">
                <label className="field">
                  PL1 (W)
                  <input
                    type="number"
                    min={MIN_POWER_LIMIT_WATTS}
                    max={MAX_PL1_WATTS}
                    aria-label="PL1 power limit in watts"
                    required
                    step={1}
                    onChange={(event) => setPL1(event.target.value)}
                    value={pl1}
                  />
                  <small>Sustained</small>
                </label>
                <label className="field">
                  PL2 (W)
                  <input
                    type="number"
                    min={MIN_POWER_LIMIT_WATTS}
                    max={MAX_PL2_WATTS}
                    aria-label="PL2 power limit in watts"
                    required
                    step={1}
                    onChange={(event) => setPL2(event.target.value)}
                    value={pl2}
                  />
                  <small>Short-term</small>
                </label>
              </div>
              <div className="form-actions">
                <span className="helper-text">
                  Use limits appropriate for this CPU.
                </span>
                <StyledApplyButton
                  type="submit"
                  disabled={!isConnected || isApplying}
                >
                  {isApplying ? "Applying…" : "Apply"}
                </StyledApplyButton>
              </div>
            </fieldset>
          </form>
        </>
      )}
    </section>
  );
}
