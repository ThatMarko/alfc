import React, { useState, useEffect } from "react";
import { Toggle } from "../components/Toggle";
import { useWebSocket } from "../utils/useWebSocket";
import { getMethods, setMethods } from "../data/mof";
import { ToggleState } from "../utils/enums";

export function Toggles() {
  const [gpuBoost, setGPUBoost] = useState(ToggleState.Unknown);
  const [isGpuBoostAvailable, setIsGpuBoostAvailable] = useState(true);

  const { isConnected, sendJsonMessage, lastJsonMessage } = useWebSocket();

  useEffect(() => {
    const { kind, data, methodName } = lastJsonMessage;
    if (kind === "state") {
      setGPUBoost(data.gpuBoost ? ToggleState.On : ToggleState.Off);
      if (data.isGpuBoostAvailable !== undefined) {
        setIsGpuBoostAvailable(data.isGpuBoostAvailable);
      }
    } else if (kind === "success") {
      // Current state only changes when we get the websocket
      // result.
      if (methodName === "GetAIBoostStatus") {
        setGPUBoost(data === 1 ? ToggleState.On : ToggleState.Off);
      } else if (methodName === "SetAIBoostStatus") {
        sendJsonMessage({
          ...getMethods["GetAIBoostStatus"],
          kind: "get",
        });
      }
    }
  }, [lastJsonMessage, sendJsonMessage]);

  if (!isConnected || !isGpuBoostAvailable) {
    return null;
  }

  const changeGPUBoost: React.ChangeEventHandler = () => {
    // State is unknown until server responds
    setGPUBoost(ToggleState.Unknown);
    sendJsonMessage({
      ...setMethods["SetAIBoostStatus"],
      kind: "set",
      data: {
        Data: gpuBoost === ToggleState.On ? 0 : 1,
      },
    });
  };

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
        value={gpuBoost}
        onChange={changeGPUBoost}
      />
    </div>
  );
}
