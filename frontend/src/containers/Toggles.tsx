import { MessageToServerKind } from "../../../common/types";
import { Toggle } from "../components/Toggle";
import { setMethods } from "../data/mof";
import { ToggleState } from "../utils/enums";
import { useBackendCommand, useWebSocket } from "../utils/useWebSocket";

export function Toggles() {
  const { isConnected, state } = useWebSocket();
  const { isPending, runCommand } = useBackendCommand();
  if (!state) return null;

  return (
    <section className="panel" aria-label="GPU boost settings">
      {state.isGpuBoostAvailable !== true ? (
        <>
          <h2>GPU Boost</h2>
          <p className="capability-unavailable">
            A supported GPU boost control was not detected.
          </p>
        </>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <h2>GPU Boost</h2>
            <Toggle
              label="GPU Boost"
              name="gpuBoost"
              disabled={!isConnected || isPending}
              value={state.gpuBoost ? ToggleState.On : ToggleState.Off}
              onChange={() => {
                void runCommand({
                  ...setMethods["SetAIBoostStatus"],
                  kind: MessageToServerKind.Set,
                  data: { Data: state.gpuBoost ? 0 : 1 },
                });
              }}
            />
          </div>
          <p className="section-description" style={{ marginTop: 8 }}>
            {isPending
              ? "Confirming change…"
              : state.gpuBoost
                ? "Enabled by the server."
                : "Disabled by the server."}
          </p>
        </>
      )}
    </section>
  );
}
