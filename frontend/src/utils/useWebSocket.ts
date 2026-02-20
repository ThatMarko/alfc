import useReactWebSocket, { ReadyState } from "react-use-websocket";
import type { MessageToClient } from "../../../common/types";

const emptyObject = {};
const shouldReconnect = (_: CloseEvent) => true;

export function useWebSocket() {
  const { lastJsonMessage, sendJsonMessage, readyState } =
    useReactWebSocket<MessageToClient | null>("ws://localhost:5522/ws", {
      share: true,
      // No application-level heartbeat — react-use-websocket's heartbeat has
      // known bugs with share:true (Issues #268, #269, #273) that cause
      // spurious disconnects (especially on sleep/wake and tab backgrounding).
      // Bun's built-in WebSocket protocol PING frames handle keepalive instead.
      retryOnError: true,
      reconnectAttempts: Number.MAX_SAFE_INTEGER,
      shouldReconnect,
    });

  return {
    lastJsonMessage:
      // Empty object is forced like this in order to avoid having to check for null in each component that uses this.
      lastJsonMessage || (emptyObject as unknown as MessageToClient),
    sendJsonMessage,
    isConnected: readyState === ReadyState.OPEN,
  };
}
