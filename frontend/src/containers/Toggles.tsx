import { MessageToServerKind } from "../../../common/types";
import { Toggle } from "../components/Toggle";
import { setMethods } from "../data/mof";
import { ToggleState } from "../utils/enums";
import { useBackendCommand, useWebSocket } from "../utils/useWebSocket";

export function Toggles() {
  const { isConnected, state } = useWebSocket();
  const { isPending, runCommand } = useBackendCommand();
  if (!isConnected || !state || state.isGpuBoostAvailable === false)
    return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Toggle
        label="GPU Boost"
        name="gpuBoost"
        disabled={isPending}
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
  );
}
