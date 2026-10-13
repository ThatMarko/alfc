import React, { useState, useEffect, useRef } from "react";
import { Toggle } from "../components/Toggle";
import { useWebSocket } from "../utils/useWebSocket";
import { getMethods, setMethods } from "../data/mof";
import { ToggleState } from "../utils/enums";
import { nextRequestId } from "../utils/misc";

export function Toggles() {
  const [gpuBoost, setGPUBoost] = useState(ToggleState.Unknown);
  const [isGpuBoostAvailable, setIsGpuBoostAvailable] = useState(true);
  const lastKnownGpuBoostRef = useRef(ToggleState.Unknown);
  const pendingRequestIdRef = useRef<string | null>(null);

  const { isConnected, sendJsonMessage, lastJsonMessage } = useWebSocket();

  useEffect(() => {
    const { kind, data, methodName, requestId } = lastJsonMessage;
    if (kind === "state") {
      const nextState = data.gpuBoost ? ToggleState.On : ToggleState.Off;
      lastKnownGpuBoostRef.current = nextState;
      setGPUBoost(nextState);
      if (data.isGpuBoostAvailable !== undefined) {
        setIsGpuBoostAvailable(data.isGpuBoostAvailable);
      }
    } else if (kind === "success") {
      if (
        pendingRequestIdRef.current !== null &&
        requestId !== pendingRequestIdRef.current
      ) {
        return;
      }
      // Current state only changes when we get the websocket
      // result.
      if (methodName === "GetAIBoostStatus") {
        pendingRequestIdRef.current = null;
        const nextState = data === 1 ? ToggleState.On : ToggleState.Off;
        lastKnownGpuBoostRef.current = nextState;
        setGPUBoost(nextState);
      } else if (methodName === "SetAIBoostStatus") {
        const getReqId = nextRequestId("gpuboost-get");
        pendingRequestIdRef.current = getReqId;
        sendJsonMessage({
          ...getMethods["GetAIBoostStatus"],
          kind: "get",
          requestId: getReqId,
        });
      }
    } else if (
      kind === "error" &&
      pendingRequestIdRef.current !== null &&
      requestId === pendingRequestIdRef.current
    ) {
      pendingRequestIdRef.current = null;
      setGPUBoost(lastKnownGpuBoostRef.current);
    }
  }, [lastJsonMessage, sendJsonMessage]);

  if (!isConnected || !isGpuBoostAvailable) {
    return null;
  }

  const changeGPUBoost: React.ChangeEventHandler = () => {
    // State is unknown until server responds
    const requestId = nextRequestId("gpuboost-set");
    pendingRequestIdRef.current = requestId;
    setGPUBoost(ToggleState.Unknown);
    sendJsonMessage({
      ...setMethods["SetAIBoostStatus"],
      kind: "set",
      requestId,
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
