import type { Server, ServerWebSocket } from "bun";
import {
  type FanControlActivity,
  MessageToClientKind,
  type MessageToServer,
  MessageToServerKind,
} from "../../common/types.js";
import { getCall, setCall, tune } from "../native/index.js";
import { persistState, state } from "../state/index.js";
import {
  setFixedFan,
  fanControl as autoFanControl,
} from "../fan-control/index.js";

let server: Server<unknown> | null = null;

type MessageMetadata = Partial<
  Pick<MessageToServer, "methodId" | "methodName">
>;

const validMessageToServerKinds = new Set<string>(
  Object.values(MessageToServerKind),
);

const requiredDataKinds = new Set<MessageToServerKind>([
  MessageToServerKind.FixedPercentage,
  MessageToServerKind.DoFixedSpeed,
  MessageToServerKind.FanTable,
  MessageToServerKind.Tune,
  MessageToServerKind.Set,
]);

export function setServer(s: Server<unknown>) {
  server = s;
}

export function publishActivity(data: FanControlActivity) {
  if (!server) return;
  server.publish(
    "activity",
    JSON.stringify({ kind: MessageToClientKind.FanControlActivity, data }),
  );
}

function sendState(ws: ServerWebSocket<unknown>) {
  ws.send(
    JSON.stringify({
      kind: MessageToClientKind.State,
      data: { ...state, protocolVersion: "1.0" },
    }),
  );
}

function sendSuccess(ws: ServerWebSocket<unknown>, payload: any, data?: any) {
  ws.send(
    JSON.stringify({
      ...payload,
      kind: MessageToClientKind.Success,
      ...(data && { data }),
    }),
  );
}

function getMessageMetadata(payload: unknown): MessageMetadata {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const maybePayload = payload as Record<string, unknown>;
  const metadata: MessageMetadata = {};

  if (typeof maybePayload.methodId === "string") {
    metadata.methodId = maybePayload.methodId;
  }

  if (typeof maybePayload.methodName === "string") {
    metadata.methodName = maybePayload.methodName;
  }

  return metadata;
}

function sendError(
  ws: ServerWebSocket<unknown>,
  payload: unknown,
  errorMessage: string,
) {
  ws.send(
    JSON.stringify({
      ...getMessageMetadata(payload),
      kind: MessageToClientKind.Error,
      data: errorMessage,
    }),
  );
}

async function handleMessage(
  ws: ServerWebSocket<unknown>,
  message: string | Buffer,
) {
  const messageString =
    typeof message === "string" ? message : message.toString();

  if (messageString === "ping") {
    ws.send("pong");
    return;
  }

  let parsedPayload: unknown;

  try {
    parsedPayload = JSON.parse(messageString);
  } catch (_error) {
    sendError(ws, null, "INVALID_JSON: Failed to parse message");
    return;
  }

  const maybePayload =
    parsedPayload && typeof parsedPayload === "object"
      ? (parsedPayload as Partial<MessageToServer>)
      : null;
  const payloadKind = maybePayload?.kind;

  if (
    !maybePayload ||
    typeof payloadKind !== "string" ||
    !validMessageToServerKinds.has(payloadKind)
  ) {
    sendError(ws, parsedPayload, `UNKNOWN_KIND: ${String(payloadKind)}`);
    return;
  }

  const payload = maybePayload as MessageToServer;

  if (
    requiredDataKinds.has(payload.kind) &&
    (payload.data === undefined || payload.data === null)
  ) {
    sendError(ws, payload, `MISSING_DATA: ${payload.kind}`);
    return;
  }

  try {
    switch (payload.kind) {
      case MessageToServerKind.RegisterActivitySocket:
        ws.subscribe("activity");
        return;
      case MessageToServerKind.FixedPercentage:
        state.fixedPercentage = payload.data;
        setFixedFan(state.fixedPercentage);
        persistState();
        return sendSuccess(ws, payload);
      case MessageToServerKind.DoFixedSpeed:
        state.doFixedSpeed = payload.data;
        if (!state.doFixedSpeed) {
          autoFanControl();
        }
        persistState();
        return sendSuccess(ws, payload);
      case MessageToServerKind.FanTable:
        if (payload.data) {
          state.cpuFanTable = payload.data.cpu;
          state.gpuFanTable = payload.data.gpu;
          persistState();
          return sendSuccess(ws, payload);
        }
        break;
      case MessageToServerKind.Tune:
        if (payload.data) {
          state.pl1 = payload.data.pl1;
          state.pl2 = payload.data.pl2;
          persistState();
          await tune();
          return sendSuccess(ws, payload);
        }
        break;
      case MessageToServerKind.Get: {
        const result = await getCall(
          payload.methodId,
          payload.methodName,
          payload.data,
        );
        return sendSuccess(ws, payload, result);
      }
      case MessageToServerKind.Set:
        if (payload.data) {
          await setCall(payload.methodId, payload.methodName, payload.data);
          if (payload.methodName === "SetAIBoostStatus") {
            state.gpuBoost = payload.data.Data === 1;
            persistState();
          }
          return sendSuccess(ws, payload);
        }
        break;
    }

    sendError(ws, payload, `MISSING_DATA: ${payload.kind}`);
  } catch (_error) {
    sendError(ws, payload, "INTERNAL_ERROR: An unexpected error occurred");
  }
}

export const websocketHandlers = {
  open(ws: ServerWebSocket<unknown>) {
    sendState(ws);
  },

  message(ws: ServerWebSocket<unknown>, message: string | Buffer) {
    handleMessage(ws, message);
  },

  close(_ws: ServerWebSocket<unknown>) {},
};
