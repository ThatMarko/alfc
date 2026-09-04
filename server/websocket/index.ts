import type { Server, ServerWebSocket } from "bun";
import {
  type FanControlActivity,
  type FanTable,
  MessageToClientKind,
  type MessageToServer,
  MessageToServerKind,
  type State,
} from "../../common/types";
import { getCall, setCall, tune } from "../native/index";
import { persistState, state } from "../state/index";
import {
  applyFixedFan,
  fanControl as autoFanControl,
} from "../fan-control/index";

let server: Server<unknown> | null = null;

type MessageMetadata = Partial<
  Pick<MessageToServer, "methodId" | "methodName" | "requestId">
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number) {
  return (
    isFiniteNumber(value) &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isValidFanTable(value: unknown): value is FanTable {
  if (!Array.isArray(value) || value.length === 0) {
    return false;
  }

  let previousTemperature = Number.NEGATIVE_INFINITY;

  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      return false;
    }

    const [temperature, percentage] = entry;
    if (!isFiniteNumber(temperature) || !isFiniteNumber(percentage)) {
      return false;
    }

    if (temperature <= previousTemperature) {
      return false;
    }

    if (percentage < 0 || percentage > 100) {
      return false;
    }

    previousTemperature = temperature;
  }

  return true;
}

export function setServer(s: Server<unknown>) {
  server = s;
}

function buildStateSnapshot(): State {
  return {
    ...state,
    protocolVersion: "1.1",
  };
}

function publishState() {
  if (!server) return;

  server.publish(
    "state",
    JSON.stringify({
      kind: MessageToClientKind.State,
      data: buildStateSnapshot(),
    }),
  );
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
      data: buildStateSnapshot(),
    }),
  );
}

function sendSuccess(
  ws: ServerWebSocket<unknown>,
  payload: MessageToServer,
  data?: unknown,
) {
  ws.send(
    JSON.stringify({
      ...payload,
      kind: MessageToClientKind.Success,
      ...(data !== undefined && { data }),
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

  if (typeof maybePayload.requestId === "string") {
    metadata.requestId = maybePayload.requestId;
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

function rejectUnsupportedFeature(
  ws: ServerWebSocket<unknown>,
  payload: unknown,
  message: string,
) {
  sendError(ws, payload, `UNSUPPORTED_FEATURE: ${message}`);
}

function rejectInvalidPayload(
  ws: ServerWebSocket<unknown>,
  payload: unknown,
  message: string,
) {
  sendError(ws, payload, `INVALID_PAYLOAD: ${message}`);
}

function rejectInvalidRange(
  ws: ServerWebSocket<unknown>,
  payload: unknown,
  message: string,
) {
  sendError(ws, payload, `INVALID_RANGE: ${message}`);
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
    console.warn("[WebSocket] Invalid message: malformed JSON");
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
    console.warn(
      `[WebSocket] Invalid message: unknown kind "${String(payloadKind)}"`,
    );
    sendError(ws, parsedPayload, `UNKNOWN_KIND: ${String(payloadKind)}`);
    return;
  }

  const payload = maybePayload as MessageToServer;

  if (
    requiredDataKinds.has(payload.kind) &&
    (payload.data === undefined || payload.data === null)
  ) {
    console.warn(
      `[WebSocket] Invalid message: missing data for "${payload.kind}"`,
    );
    sendError(ws, payload, `MISSING_DATA: ${payload.kind}`);
    return;
  }

  try {
    switch (payload.kind) {
      case MessageToServerKind.RegisterActivitySocket:
        ws.subscribe("activity");
        return;
      case MessageToServerKind.FixedPercentage: {
        if (state.isFanControlAvailable === false) {
          return rejectUnsupportedFeature(
            ws,
            payload,
            "Fan control is not available on this system",
          );
        }
        if (!isIntegerInRange(payload.data, 0, 100)) {
          return rejectInvalidRange(
            ws,
            payload,
            "fixedpercentage must be an integer from 0 to 100",
          );
        }

        const previousFixedPercentage = state.fixedPercentage;
        state.fixedPercentage = payload.data;
        try {
          if (state.doFixedSpeed) {
            await applyFixedFan(state.fixedPercentage);
          }
        } catch (error) {
          state.fixedPercentage = previousFixedPercentage;
          throw error;
        }
        persistState();
        publishState();
        return sendSuccess(ws, payload);
      }
      case MessageToServerKind.DoFixedSpeed: {
        if (state.isFanControlAvailable === false) {
          return rejectUnsupportedFeature(
            ws,
            payload,
            "Fan control is not available on this system",
          );
        }
        if (!isBoolean(payload.data)) {
          return rejectInvalidPayload(
            ws,
            payload,
            "dofixedspeed requires a boolean payload",
          );
        }

        const previousDoFixedSpeed = state.doFixedSpeed;
        state.doFixedSpeed = payload.data;
        try {
          if (state.doFixedSpeed) {
            await applyFixedFan(state.fixedPercentage);
          } else {
            autoFanControl();
          }
        } catch (error) {
          state.doFixedSpeed = previousDoFixedSpeed;
          throw error;
        }
        persistState();
        publishState();
        return sendSuccess(ws, payload);
      }
      case MessageToServerKind.FanTable:
        if (state.isFanControlAvailable === false) {
          return rejectUnsupportedFeature(
            ws,
            payload,
            "Fan control is not available on this system",
          );
        }
        if (
          !payload.data ||
          typeof payload.data !== "object" ||
          !isValidFanTable(payload.data.cpu) ||
          !isValidFanTable(payload.data.gpu)
        ) {
          return rejectInvalidPayload(
            ws,
            payload,
            "fantable requires ascending CPU and GPU tables with percentages from 0 to 100",
          );
        }

        state.cpuFanTable = payload.data.cpu;
        state.gpuFanTable = payload.data.gpu;
        persistState();
        publishState();
        return sendSuccess(ws, payload);
      case MessageToServerKind.Tune: {
        if (state.isCpuTuningAvailable === false) {
          return rejectUnsupportedFeature(
            ws,
            payload,
            "CPU tuning is not available on this system",
          );
        }
        if (
          !payload.data ||
          typeof payload.data !== "object" ||
          !isIntegerInRange(payload.data.pl1, 0, 200) ||
          !isIntegerInRange(payload.data.pl2, 0, 200)
        ) {
          return rejectInvalidRange(
            ws,
            payload,
            "tune requires integer pl1/pl2 values from 0 to 200",
          );
        }

        const previousPl1 = state.pl1;
        const previousPl2 = state.pl2;

        state.pl1 = payload.data.pl1;
        state.pl2 = payload.data.pl2;
        try {
          await tune();
        } catch (error) {
          state.pl1 = previousPl1;
          state.pl2 = previousPl2;
          throw error;
        }

        persistState();
        publishState();
        return sendSuccess(ws, payload);
      }
      case MessageToServerKind.Get: {
        const result = await getCall(
          payload.methodId,
          payload.methodName,
          payload.data,
        );
        if (Number.isNaN(result)) {
          return sendError(ws, payload, "ACPI_ERROR: Get call failed");
        }
        return sendSuccess(ws, payload, result);
      }
      case MessageToServerKind.Set:
        if (payload.methodName === "SetAIBoostStatus") {
          if (state.isGpuBoostAvailable === false) {
            return rejectUnsupportedFeature(
              ws,
              payload,
              "GPU boost is not available on this system",
            );
          }
          if (
            !payload.data ||
            typeof payload.data !== "object" ||
            ![0, 1].includes(payload.data.Data)
          ) {
            return rejectInvalidPayload(
              ws,
              payload,
              "SetAIBoostStatus requires Data to be 0 or 1",
            );
          }
        }

        await setCall(payload.methodId, payload.methodName, payload.data);
        if (payload.methodName === "SetAIBoostStatus") {
          state.gpuBoost = payload.data.Data === 1;
          persistState();
          publishState();
        }
        return sendSuccess(ws, payload);
    }

    sendError(ws, payload, `MISSING_DATA: ${payload.kind}`);
  } catch (_error) {
    sendError(ws, payload, "INTERNAL_ERROR: An unexpected error occurred");
  }
}

export const websocketHandlers = {
  open(ws: ServerWebSocket<unknown>) {
    console.log("[WebSocket] Client connected");
    ws.subscribe("state");
    sendState(ws);
  },

  message(ws: ServerWebSocket<unknown>, message: string | Buffer) {
    handleMessage(ws, message);
  },

  close(_ws: ServerWebSocket<unknown>) {
    console.log("[WebSocket] Client disconnected");
  },
};
