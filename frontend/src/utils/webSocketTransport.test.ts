import { MessageToServerKind } from "../../../common/types";
import { parseBackendMessage, sendBackendMessage } from "./webSocketTransport";

describe("backend WebSocket transport", () => {
  const message = { kind: MessageToServerKind.Tune, requestId: "tune-1" };

  it("rejects closed transports immediately even when native send would discard data", () => {
    for (const readyState of [0, 2, 3] as const) {
      const socket = { readyState, bufferedAmount: 0, send: vi.fn() };
      expect(() => sendBackendMessage(socket, message)).toThrow("disconnected");
      expect(socket.send).not.toHaveBeenCalled();
    }
  });

  it("bounds queued transport data without buffering another hardware command", () => {
    const socket = {
      readyState: WebSocket.OPEN,
      bufferedAmount: 64 * 1024,
      send: vi.fn(),
    } satisfies Pick<WebSocket, "readyState" | "bufferedAmount" | "send">;
    expect(() => sendBackendMessage(socket, message)).toThrow(
      "connection is busy",
    );
    expect(socket.send).not.toHaveBeenCalled();
    socket.bufferedAmount = 0;
    sendBackendMessage(socket, message);
    expect(socket.send).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify(message),
    );
  });

  it("accepts only JSON text objects and ignores malformed or binary messages", () => {
    for (const value of [
      "pong",
      "{",
      "null",
      "false",
      "[]",
      "123",
      new Uint8Array([123, 125]),
      new Blob(['{"kind":"success"}']),
      { kind: "state" },
    ]) {
      expect(parseBackendMessage(value)).toBeNull();
    }
    expect(parseBackendMessage('{"kind":"success","data":0}')).toEqual({
      kind: "success",
      data: 0,
    });
  });
});
