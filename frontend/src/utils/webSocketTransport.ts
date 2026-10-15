import type { MessageToServer } from "../../../common/types";

const MAX_BUFFERED_BYTES = 64 * 1024;

export function parseBackendMessage(
  data: unknown,
): Record<string, unknown> | null {
  // The backend sends JSON text. Blob/ArrayBuffer messages must not be coerced
  // into JSON or decoded asynchronously after the connection has changed.
  if (typeof data !== "string") return null;
  try {
    const message: unknown = JSON.parse(data);
    return message !== null &&
      typeof message === "object" &&
      !Array.isArray(message)
      ? (message as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function sendBackendMessage(
  socket: Pick<WebSocket, "readyState" | "bufferedAmount" | "send">,
  message: MessageToServer,
) {
  // WebSocket.send silently discards data in CLOSING/CLOSED; the hook's
  // keep=false similarly drops messages. Check the actual socket immediately
  // before sending so an unsent hardware command fails without a long timeout.
  if (socket.readyState !== WebSocket.OPEN)
    throw new Error(
      "The server is disconnected. Reconnect before applying changes.",
    );
  if (socket.bufferedAmount >= MAX_BUFFERED_BYTES)
    throw new Error(
      "The server connection is busy. Wait for pending data to send before applying more changes.",
    );
  socket.send(JSON.stringify(message));
}
