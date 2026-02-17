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
  ws.send(JSON.stringify({ kind: MessageToClientKind.State, data: state }));
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

  const payload: MessageToServer = JSON.parse(messageString);
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

    ws.send(
      JSON.stringify({
        ...payload,
        kind: MessageToClientKind.Error,
        data: "Either unknown message kind or missing payload data.",
      }),
    );
  } catch (error) {
    if (error instanceof Error) {
      ws.send(
        JSON.stringify({
          ...payload,
          kind: MessageToClientKind.Error,
          data: error.stack,
        }),
      );
    }
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
