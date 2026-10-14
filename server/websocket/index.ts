import type { Server, ServerWebSocket, WebSocketHandler } from "bun";
import {
  type Args,
  type FanControlActivity,
  type FanTable,
  MessageToClientKind,
  type MessageToServer,
  MessageToServerKind,
  type State,
} from "../../common/types";
import { validateFanTable } from "../../common/validation";
import {
  getMethods,
  managedFanMethods,
  setMethods,
} from "../../common/methods";
import { getCall, setCall, tune } from "../native/index";
import { persistState, state } from "../state/index";
import { applyFixedFan } from "../fan-control/index";

type Publisher = Pick<Server<unknown>, "publish">;
let servers: readonly Publisher[] = [];
let messageQueue: Promise<void> = Promise.resolve();
let queuedMessages = 0;
let isShuttingDown = false;
const MAX_QUEUED_MESSAGES = 64;
const MAX_BACKPRESSURE_BYTES = 1024 * 1024;
const openSockets = new Set<ServerWebSocket<unknown>>();
let backpressureCheck: ReturnType<typeof setTimeout> | undefined;
// Binary WebSocket messages are Buffers by default. Buffer.toString() would
// replace invalid UTF-8 and could execute a corrupted request with a changed ID.
// Keep a BOM in the decoded text so JSON.parse treats binary and text equally.
const binaryMessageDecoder = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: true,
});

export function startWebSocketShutdown(): Promise<void> {
  isShuttingDown = true;
  openSockets.clear();
  clearBackpressureCheck();
  return messageQueue;
}

function clearBackpressureCheck() {
  if (backpressureCheck !== undefined) clearTimeout(backpressureCheck);
  backpressureCheck = undefined;
}

function forgetSocket(ws: ServerWebSocket<unknown>) {
  openSockets.delete(ws);
  if (openSockets.size === 0) clearBackpressureCheck();
}

function retireSocket(ws: ServerWebSocket<unknown>) {
  // Remove before terminate: a close callback may run synchronously, or the
  // platform may deliver it later. Neither case should retain the slow peer.
  forgetSocket(ws);
  if (ws.readyState === WebSocket.OPEN) ws.terminate();
}

function enforceBackpressure(ws: ServerWebSocket<unknown>): boolean {
  if (ws.readyState !== WebSocket.OPEN) {
    forgetSocket(ws);
    return false;
  }
  if (ws.getBufferedAmount() < MAX_BACKPRESSURE_BYTES) return true;
  retireSocket(ws);
  return false;
}

function checkBackpressure() {
  for (const ws of openSockets) enforceBackpressure(ws);
}

function scheduleBackpressureCheck() {
  if (isShuttingDown || openSockets.size === 0) return;
  // Bun corks callbacks and may flush pub/sub after publish() returns. One
  // coalesced check follows the latest output, including a later native flush
  // queued after an earlier check. Keep at most one outstanding timer.
  clearBackpressureCheck();
  backpressureCheck = setTimeout(() => {
    backpressureCheck = undefined;
    checkBackpressure();
  }, 0);
  backpressureCheck.unref();
}

function sendText(ws: ServerWebSocket<unknown>, message: string) {
  if (!enforceBackpressure(ws)) return;
  const status = ws.send(message);
  // -1 already enqueued this reply: retrying would duplicate it. A dropped
  // reply on an open transport instead needs a reconnect and fresh snapshot.
  if (status === 0) {
    retireSocket(ws);
    return;
  }
  enforceBackpressure(ws);
  scheduleBackpressureCheck();
}

function publish(topic: string, message: string) {
  checkBackpressure();
  for (const server of servers) server.publish(topic, message);
  checkBackpressure();
  scheduleBackpressureCheck();
}

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

function isIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    isFiniteNumber(value) &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isValidFanTable(value: unknown): value is FanTable {
  return validateFanTable(value) === null;
}

function isArgsRecord(value: unknown): value is Args {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every(
    (entry) => typeof entry === "number" && Number.isFinite(entry),
  );
}

function validateNativeCall(
  payload: MessageToServer,
): { methodId: string; methodName: string; args: Args } | string {
  if (
    typeof payload.methodId !== "string" ||
    !/^(?:0x[\da-f]+|\d+)$/i.test(payload.methodId) ||
    typeof payload.methodName !== "string"
  ) {
    return "get/set require a numeric methodId and a known methodName";
  }
  const methods =
    payload.kind === MessageToServerKind.Get ? getMethods : setMethods;
  const method = Object.hasOwn(methods, payload.methodName)
    ? methods[payload.methodName]
    : undefined;
  if (!method || Number(payload.methodId) !== Number(method.methodId)) {
    return "methodId and methodName must identify the same documented method";
  }
  const args = payload.data === undefined ? {} : payload.data;
  if (!isArgsRecord(args)) {
    return "get/set data must be an argument map";
  }
  if (Object.keys(args).length !== method.inArgs.length) {
    return "arguments must match the documented method signature";
  }
  const orderedArgs: Args = {};
  for (const argument of method.inArgs) {
    const maximum = argument.type === "uint16" ? 65535 : 255;
    if (
      !Object.hasOwn(args, argument.name) ||
      !isIntegerInRange(args[argument.name], 0, maximum)
    ) {
      return `${argument.name} must be a ${argument.type} integer`;
    }
    // Linux transports arguments by position, Windows by name. Preserve the
    // canonical signature order independently of JSON property order.
    orderedArgs[argument.name] = args[argument.name] as number;
  }
  return {
    methodId: method.methodId,
    methodName: method.methodName,
    args: orderedArgs,
  };
}

export function setServer(s: Server<unknown>) {
  setServers([s]);
}

export function setServers(listeners: readonly Publisher[]) {
  // One publisher per listener, even if the caller repeats a reference.
  servers = [...new Set(listeners)];
}

function buildStateSnapshot(): State {
  return {
    ...state,
    protocolVersion: "1.1",
  };
}

export function publishState() {
  if (servers.length === 0) return;
  const message = JSON.stringify({
    kind: MessageToClientKind.State,
    data: buildStateSnapshot(),
  });
  publish("state", message);
}

export function publishActivity(data: FanControlActivity) {
  if (servers.length === 0) return;
  const message = JSON.stringify({
    kind: MessageToClientKind.FanControlActivity,
    data,
  });
  publish("activity", message);
}

function sendState(ws: ServerWebSocket<unknown>) {
  sendText(
    ws,
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
  sendText(
    ws,
    JSON.stringify({
      ...getMessageMetadata(payload),
      kind: MessageToClientKind.Success,
      data: data !== undefined ? data : payload.data,
    }),
  );
}

async function persistAndPublishState(
  ws: ServerWebSocket<unknown>,
  payload: MessageToServer,
): Promise<void> {
  try {
    await persistState();
  } catch (_) {
    // Hardware has already accepted this configuration. Publish the real
    // active state even when its durable save failed, then tell the caller.
    publishState();
    sendError(
      ws,
      payload,
      "PERSISTENCE_ERROR: Configuration is active but could not be saved",
    );
    return;
  }
  publishState();
  sendSuccess(ws, payload);
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
  sendText(
    ws,
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

function restartRequiredCause(error: unknown): Error | undefined {
  const seen = new Set<Error>();
  let cause = error;
  while (cause instanceof Error && !seen.has(cause)) {
    if ("restartRequired" in cause && cause.restartRequired === true)
      return cause;
    seen.add(cause);
    cause = cause.cause;
  }
  return undefined;
}

async function handleMessage(
  ws: ServerWebSocket<unknown>,
  parsedPayload: unknown,
) {
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
    // A JSON object can shadow toString/valueOf, so coercing an arbitrary
    // kind before validation can itself throw and bypass a structured reply.
    const description =
      typeof payloadKind === "string" ? payloadKind : typeof payloadKind;
    console.warn(`[WebSocket] Invalid message: unknown kind "${description}"`);
    sendError(ws, parsedPayload, `UNKNOWN_KIND: ${description}`);
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

        if (state.doFixedSpeed) {
          await applyFixedFan(payload.data);
        }
        state.fixedPercentage = payload.data;
        return persistAndPublishState(ws, payload);
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

        if (payload.data) {
          await applyFixedFan(state.fixedPercentage);
        }
        state.doFixedSpeed = payload.data;
        // Monitoring runs in both modes. Keep its current applied speed when
        // returning to a curve instead of resetting hot fans to the minimum.
        return persistAndPublishState(ws, payload);
      }
      case MessageToServerKind.FanTable: {
        if (state.isFanControlAvailable === false) {
          return rejectUnsupportedFeature(
            ws,
            payload,
            "Fan control is not available on this system",
          );
        }
        const fanTableData =
          payload.data && typeof payload.data === "object"
            ? (payload.data as { cpu?: unknown; gpu?: unknown })
            : null;
        if (
          !fanTableData ||
          !isValidFanTable(fanTableData.cpu) ||
          !isValidFanTable(fanTableData.gpu)
        ) {
          return rejectInvalidPayload(
            ws,
            payload,
            "fantable requires ascending CPU and GPU tables with percentages from 0 to 100",
          );
        }

        state.cpuFanTable = fanTableData.cpu;
        state.gpuFanTable = fanTableData.gpu;
        return persistAndPublishState(ws, payload);
      }
      case MessageToServerKind.Tune: {
        if (state.isCpuTuningAvailable === false) {
          return rejectUnsupportedFeature(
            ws,
            payload,
            "CPU tuning is not available on this system",
          );
        }
        const tuneData =
          payload.data && typeof payload.data === "object"
            ? (payload.data as { pl1?: unknown; pl2?: unknown })
            : null;
        if (
          !tuneData ||
          !isIntegerInRange(tuneData.pl1, 0, 200) ||
          !isIntegerInRange(tuneData.pl2, 0, 200)
        ) {
          return rejectInvalidRange(
            ws,
            payload,
            "tune requires integer pl1/pl2 values from 0 to 200",
          );
        }

        await tune(tuneData.pl1, tuneData.pl2);
        state.pl1 = tuneData.pl1;
        state.pl2 = tuneData.pl2;
        return persistAndPublishState(ws, payload);
      }
      case MessageToServerKind.Get: {
        const call = validateNativeCall(payload);
        if (typeof call === "string")
          return rejectInvalidPayload(ws, payload, call);
        const result = await getCall(call.methodId, call.methodName, call.args);
        if (typeof result === "number" && !Number.isFinite(result)) {
          return sendError(ws, payload, "ACPI_ERROR: Get call failed");
        }
        return sendSuccess(ws, payload, result);
      }
      case MessageToServerKind.Set: {
        const call = validateNativeCall(payload);
        if (typeof call === "string")
          return rejectInvalidPayload(ws, payload, call);
        if (managedFanMethods.has(call.methodName)) {
          return sendError(
            ws,
            payload,
            "MANAGED_FAN_CONTROL: Use the fan mode, percentage, and curve commands",
          );
        }
        if (payload.methodName === "SetAIBoostStatus") {
          if (state.isGpuBoostAvailable === false) {
            return rejectUnsupportedFeature(
              ws,
              payload,
              "GPU boost is not available on this system",
            );
          }
          if (
            !isArgsRecord(payload.data) ||
            typeof payload.data.Data !== "number" ||
            ![0, 1].includes(payload.data.Data)
          ) {
            return rejectInvalidPayload(
              ws,
              payload,
              "SetAIBoostStatus requires Data to be 0 or 1",
            );
          }
        }

        if (!isArgsRecord(payload.data)) {
          return rejectInvalidPayload(
            ws,
            payload,
            "set requires an argument map of finite numbers",
          );
        }

        await setCall(call.methodId, call.methodName, call.args);
        if (payload.methodName === "SetAIBoostStatus") {
          state.gpuBoost = payload.data.Data === 1;
          return persistAndPublishState(ws, payload);
        }
        return sendSuccess(ws, payload);
      }
    }

    sendError(ws, payload, `MISSING_DATA: ${payload.kind}`);
  } catch (error) {
    const restartError = restartRequiredCause(error);
    if (restartError) {
      // Native adapters may already include the wire code in their message.
      // Expose one code even when multiple failure wrappers preserved it.
      const detail = restartError.message.replace(
        /^(?:RESTART_REQUIRED:\s*)+/,
        "",
      );
      sendError(ws, payload, `RESTART_REQUIRED: ${detail}`);
      return;
    }
    sendError(ws, payload, "INTERNAL_ERROR: An unexpected error occurred");
  }
}

export const websocketHandlers = {
  sendPings: true,
  idleTimeout: 120,
  maxPayloadLength: 64 * 1024,
  backpressureLimit: MAX_BACKPRESSURE_BYTES,
  closeOnBackpressureLimit: true,

  open(ws: ServerWebSocket<unknown>) {
    console.log("[WebSocket] Client connected");
    if (isShuttingDown) {
      ws.terminate();
      return;
    }
    openSockets.add(ws);
    ws.subscribe("state");
    sendState(ws);
  },

  message(ws: ServerWebSocket<unknown>, message: string | Buffer) {
    let messageString: string;
    try {
      messageString =
        typeof message === "string"
          ? message
          : binaryMessageDecoder.decode(message);
    } catch (_) {
      sendError(ws, null, "INVALID_JSON: Failed to parse message");
      return Promise.resolve();
    }
    if (messageString === "ping") {
      sendText(ws, "pong");
      return Promise.resolve();
    }
    let payload: unknown;
    try {
      payload = JSON.parse(messageString);
    } catch (_) {
      sendError(ws, null, "INVALID_JSON: Failed to parse message");
      return Promise.resolve();
    }
    if (isShuttingDown) {
      sendError(ws, payload, "SHUTTING_DOWN: The server is shutting down");
      return Promise.resolve();
    }
    // Activity subscription is connection setup, independent of hardware
    // commands. A busy queue must not permanently silence a new client.
    if (
      payload !== null &&
      typeof payload === "object" &&
      "kind" in payload &&
      payload.kind === MessageToServerKind.RegisterActivitySocket
    ) {
      ws.subscribe("activity");
      return Promise.resolve();
    }
    if (queuedMessages >= MAX_QUEUED_MESSAGES) {
      sendError(ws, payload, "BUSY: Too many pending requests");
      return Promise.resolve();
    }
    queuedMessages++;
    // One queue across all sockets: an older failed mutation must never
    // roll back or publish over a newer successful mutation from another UI.
    const result = messageQueue
      .then(async () => {
        if (isShuttingDown) {
          sendError(ws, payload, "SHUTTING_DOWN: The server is shutting down");
          return;
        }
        await handleMessage(ws, payload);
      })
      .finally(() => {
        queuedMessages--;
      });
    messageQueue = result.catch((error: unknown) => {
      console.warn("[WebSocket] Failed to handle message:", error);
    });
    return result;
  },

  close(ws: ServerWebSocket<unknown>, code: number, reason: string) {
    forgetSocket(ws);
    console.log(
      `[WebSocket] Client disconnected (code: ${code}${reason ? `, reason: ${reason}` : ""})`,
    );
  },
} satisfies WebSocketHandler<unknown>;
