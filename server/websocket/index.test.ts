import type {
  FanTable,
  MessageToClient,
  MessageToServer,
  State,
} from "../../common/types";
import { MessageToClientKind, MessageToServerKind } from "../../common/types";
import { applyFixedFan, fanControl } from "../fan-control/index";
import { getCall, setCall, tune } from "../native/index";
import { persistState, state } from "../state/index";
import { setServer, websocketHandlers } from "./index";

vi.mock("../native/index", () => ({
  getCall: vi.fn(),
  setCall: vi.fn().mockResolvedValue(undefined),
  tune: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../fan-control/index", () => ({
  applyFixedFan: vi.fn().mockResolvedValue(undefined),
  fanControl: vi.fn(),
}));

vi.mock("../state/index", () => ({
  state: {
    protocolVersion: "1.1",
    cpuFanTable: [
      [40, 15],
      [83, 50],
      [88, 100],
    ],
    gpuFanTable: [
      [40, 15],
      [78, 50],
      [83, 100],
    ],
    doFixedSpeed: false,
    fixedPercentage: 50,
    gpuBoost: true,
    pl1: 37,
    pl2: 106,
  },
  persistState: vi.fn().mockResolvedValue(undefined),
}));

const mockedGetCall = vi.mocked(getCall);
const mockedSetCall = vi.mocked(setCall);
const mockedTune = vi.mocked(tune);
const mockedPersistState = vi.mocked(persistState);
const mockedApplyFixedFan = vi.mocked(applyFixedFan);
const mockedAutoFanControl = vi.mocked(fanControl);

const DEFAULT_STATE: State = {
  protocolVersion: "1.1",
  cpuFanTable: [
    [40, 15],
    [83, 50],
    [88, 100],
  ],
  gpuFanTable: [
    [40, 15],
    [78, 50],
    [83, 100],
  ],
  doFixedSpeed: false,
  fixedPercentage: 50,
  gpuBoost: true,
  pl1: 37,
  pl2: 106,
};

type MockSocket = {
  send: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
};

type MockServer = {
  publish: ReturnType<typeof vi.fn>;
};

function cloneFanTable(table: FanTable): FanTable {
  return table.map(
    ([temperature, percentage]) =>
      [temperature, percentage] as [number, number],
  );
}

function resetStateToDefaults() {
  state.cpuFanTable = cloneFanTable(DEFAULT_STATE.cpuFanTable);
  state.gpuFanTable = cloneFanTable(DEFAULT_STATE.gpuFanTable);
  state.doFixedSpeed = DEFAULT_STATE.doFixedSpeed;
  state.fixedPercentage = DEFAULT_STATE.fixedPercentage;
  state.gpuBoost = DEFAULT_STATE.gpuBoost;
  state.pl1 = DEFAULT_STATE.pl1;
  state.pl2 = DEFAULT_STATE.pl2;
  state.isCpuTuningAvailable = true;
  state.isGpuBoostAvailable = true;
  state.isFanControlAvailable = true;
}

function createSocket(): MockSocket {
  return {
    send: vi.fn(),
    subscribe: vi.fn(),
  };
}

function createServer(): MockServer {
  return {
    publish: vi.fn(),
  };
}

function dispatchMessage(
  ws: MockSocket,
  payload: MessageToServer | string | Buffer,
) {
  websocketHandlers.message(
    ws as unknown as import("bun").ServerWebSocket<unknown>,
    typeof payload === "string" || Buffer.isBuffer(payload)
      ? payload
      : JSON.stringify(payload),
  );
}

function getLastSentJson(ws: MockSocket): MessageToClient {
  const rawMessage = ws.send.mock.calls.at(-1)?.[0];
  expect(typeof rawMessage).toBe("string");
  return JSON.parse(rawMessage as string) as MessageToClient;
}

function getLastPublishedJson(server: MockServer): MessageToClient {
  const rawMessage = server.publish.mock.calls.at(-1)?.[1];
  expect(typeof rawMessage).toBe("string");
  return JSON.parse(rawMessage as string) as MessageToClient;
}

describe("websocket contract", () => {
  let server: MockServer;

  beforeEach(() => {
    vi.clearAllMocks();
    resetStateToDefaults();
    mockedGetCall.mockResolvedValue(0);
    mockedSetCall.mockResolvedValue(undefined);
    mockedTune.mockResolvedValue(undefined);
    mockedPersistState.mockResolvedValue(undefined);
    mockedApplyFixedFan.mockResolvedValue(undefined);
    server = createServer();
    setServer(server as unknown as import("bun").Server<unknown>);
  });

  it("sends a protocol versioned state snapshot on open", () => {
    const ws = createSocket();

    websocketHandlers.open(
      ws as unknown as import("bun").ServerWebSocket<unknown>,
    );

    const message = getLastSentJson(ws);
    expect(ws.subscribe).toHaveBeenCalledWith("state");
    expect(message.kind).toBe(MessageToClientKind.State);
    expect(message.data).toEqual({
      ...state,
      protocolVersion: "1.1",
    });
  });

  it("subscribes to activity channel for registeractivitysocket", async () => {
    const ws = createSocket();

    dispatchMessage(ws, {
      kind: MessageToServerKind.RegisterActivitySocket,
      methodId: "register-activity",
      methodName: "RegisterActivitySocket",
    });

    await vi.waitFor(() => {
      expect(ws.subscribe).toHaveBeenCalledWith("activity");
    });
    expect(ws.send).not.toHaveBeenCalled();
  });

  it("handles fixedpercentage by mutating state and persisting", async () => {
    const ws = createSocket();

    dispatchMessage(ws, {
      kind: MessageToServerKind.FixedPercentage,
      methodId: "fixed-percentage",
      methodName: "SetFixedPercentage",
      data: 64,
    });

    await vi.waitFor(() => {
      expect(ws.send).toHaveBeenCalledTimes(1);
    });

    expect(state.fixedPercentage).toBe(64);
    expect(mockedApplyFixedFan).not.toHaveBeenCalled();
    expect(mockedPersistState).toHaveBeenCalledTimes(1);
    expect(server.publish).toHaveBeenCalledWith("state", expect.any(String));
    expect(getLastPublishedJson(server)).toEqual({
      kind: MessageToClientKind.State,
      data: {
        ...state,
        protocolVersion: "1.1",
      },
    });
    expect(getLastSentJson(ws)).toEqual({
      kind: MessageToClientKind.Success,
      methodId: "fixed-percentage",
      methodName: "SetFixedPercentage",
      data: 64,
    });
  });

  it("applies fixedpercentage immediately when fixed mode is already enabled", async () => {
    const ws = createSocket();
    state.doFixedSpeed = true;

    dispatchMessage(ws, {
      kind: MessageToServerKind.FixedPercentage,
      methodId: "fixed-percentage-active",
      methodName: "SetFixedPercentage",
      data: 64,
    });

    await vi.waitFor(() => {
      expect(ws.send).toHaveBeenCalledTimes(1);
    });

    expect(mockedApplyFixedFan).toHaveBeenCalledWith(64);
    expect(getLastSentJson(ws)).toEqual({
      kind: MessageToClientKind.Success,
      methodId: "fixed-percentage-active",
      methodName: "SetFixedPercentage",
      data: 64,
    });
  });

  it("handles dofixedspeed and re-enters auto fan control when disabled", async () => {
    const ws = createSocket();
    state.doFixedSpeed = true;

    dispatchMessage(ws, {
      kind: MessageToServerKind.DoFixedSpeed,
      methodId: "do-fixed-speed",
      methodName: "SetDoFixedSpeed",
      data: false,
    });

    await vi.waitFor(() => {
      expect(ws.send).toHaveBeenCalledTimes(1);
    });

    expect(state.doFixedSpeed).toBe(false);
    expect(mockedAutoFanControl).toHaveBeenCalledTimes(1);
    expect(mockedPersistState).toHaveBeenCalledTimes(1);
    expect(server.publish).toHaveBeenCalledWith("state", expect.any(String));
    expect(getLastSentJson(ws)).toEqual({
      kind: MessageToClientKind.Success,
      methodId: "do-fixed-speed",
      methodName: "SetDoFixedSpeed",
      data: false,
    });
  });

  it("applies the stored fixed speed immediately when fixed mode is enabled", async () => {
    const ws = createSocket();
    state.fixedPercentage = 72;

    dispatchMessage(ws, {
      kind: MessageToServerKind.DoFixedSpeed,
      methodId: "enable-fixed-speed",
      methodName: "SetDoFixedSpeed",
      data: true,
    });

    await vi.waitFor(() => {
      expect(ws.send).toHaveBeenCalledTimes(1);
    });

    expect(state.doFixedSpeed).toBe(true);
    expect(mockedApplyFixedFan).toHaveBeenCalledWith(72);
    expect(getLastSentJson(ws)).toEqual({
      kind: MessageToClientKind.Success,
      methodId: "enable-fixed-speed",
      methodName: "SetDoFixedSpeed",
      data: true,
    });
  });

  it("rejects fixedpercentage when applying the active fixed speed fails", async () => {
    const ws = createSocket();
    state.doFixedSpeed = true;
    mockedApplyFixedFan.mockRejectedValueOnce(new Error("ec write failed"));

    dispatchMessage(ws, {
      kind: MessageToServerKind.FixedPercentage,
      methodId: "fixed-percentage-apply-failed",
      methodName: "SetFixedPercentage",
      data: 64,
    });

    await vi.waitFor(() => {
      expect(ws.send).toHaveBeenCalledTimes(1);
    });

    expect(state.fixedPercentage).toBe(DEFAULT_STATE.fixedPercentage);
    expect(mockedPersistState).not.toHaveBeenCalled();
    expect(server.publish).not.toHaveBeenCalled();
    expect(getLastSentJson(ws)).toEqual({
      kind: MessageToClientKind.Error,
      methodId: "fixed-percentage-apply-failed",
      methodName: "SetFixedPercentage",
      data: "INTERNAL_ERROR: An unexpected error occurred",
    });
  });

  it("handles fantable updates and persists new tables", async () => {
    const ws = createSocket();
    const cpuTable: FanTable = [
      [35, 20],
      [80, 75],
      [90, 100],
    ];
    const gpuTable: FanTable = [
      [35, 25],
      [80, 65],
      [90, 100],
    ];

    dispatchMessage(ws, {
      kind: MessageToServerKind.FanTable,
      methodId: "fan-table",
      methodName: "SetFanTable",
      data: {
        cpu: cpuTable,
        gpu: gpuTable,
      },
    });

    await vi.waitFor(() => {
      expect(ws.send).toHaveBeenCalledTimes(1);
    });

    expect(state.cpuFanTable).toEqual(cpuTable);
    expect(state.gpuFanTable).toEqual(gpuTable);
    expect(mockedPersistState).toHaveBeenCalledTimes(1);
    expect(server.publish).toHaveBeenCalledWith("state", expect.any(String));
    expect(getLastSentJson(ws)).toEqual({
      kind: MessageToClientKind.Success,
      methodId: "fan-table",
      methodName: "SetFanTable",
      data: {
        cpu: cpuTable,
        gpu: gpuTable,
      },
    });
  });

  it("handles tune updates by mutating pl1/pl2 and calling native tune", async () => {
    const ws = createSocket();

    dispatchMessage(ws, {
      kind: MessageToServerKind.Tune,
      methodId: "tune",
      methodName: "SetCpuTune",
      data: {
        pl1: 45,
        pl2: 95,
      },
    });

    await vi.waitFor(() => {
      expect(ws.send).toHaveBeenCalledTimes(1);
    });

    expect(state.pl1).toBe(45);
    expect(state.pl2).toBe(95);
    expect(mockedPersistState).toHaveBeenCalledTimes(1);
    expect(mockedTune).toHaveBeenCalledTimes(1);
    expect(server.publish).toHaveBeenCalledWith("state", expect.any(String));
    expect(getLastSentJson(ws)).toEqual({
      kind: MessageToClientKind.Success,
      methodId: "tune",
      methodName: "SetCpuTune",
      data: {
        pl1: 45,
        pl2: 95,
      },
    });
  });

  it("handles get calls and forwards result in success payload", async () => {
    const ws = createSocket();
    mockedGetCall.mockResolvedValueOnce(42);

    dispatchMessage(ws, {
      kind: MessageToServerKind.Get,
      methodId: "0x129",
      methodName: "GetSomething",
      data: { Data: 1 },
    });

    await vi.waitFor(() => {
      expect(ws.send).toHaveBeenCalledTimes(1);
    });

    expect(mockedGetCall).toHaveBeenCalledWith("0x129", "GetSomething", {
      Data: 1,
    });
    expect(getLastSentJson(ws)).toEqual({
      kind: MessageToClientKind.Success,
      methodId: "0x129",
      methodName: "GetSomething",
      data: 42,
    });
  });

  it("handles set for SetAIBoostStatus and mutates gpuBoost state", async () => {
    const ws = createSocket();
    state.gpuBoost = true;

    dispatchMessage(ws, {
      kind: MessageToServerKind.Set,
      methodId: "129",
      methodName: "SetAIBoostStatus",
      data: { Data: 0 },
    });

    await vi.waitFor(() => {
      expect(ws.send).toHaveBeenCalledTimes(1);
    });

    expect(mockedSetCall).toHaveBeenCalledWith("129", "SetAIBoostStatus", {
      Data: 0,
    });
    expect(state.gpuBoost).toBe(false);
    expect(mockedPersistState).toHaveBeenCalledTimes(1);
    expect(server.publish).toHaveBeenCalledWith("state", expect.any(String));
    expect(getLastSentJson(ws)).toEqual({
      kind: MessageToClientKind.Success,
      methodId: "129",
      methodName: "SetAIBoostStatus",
      data: { Data: 0 },
    });
  });

  it("echoes a client-supplied requestId in success responses", async () => {
    const ws = createSocket();
    mockedGetCall.mockResolvedValueOnce(42);

    dispatchMessage(ws, {
      kind: MessageToServerKind.Get,
      methodId: "0x129",
      methodName: "GetSomething",
      requestId: "rawui-1",
      data: { Data: 1 },
    });

    await vi.waitFor(() => {
      expect(ws.send).toHaveBeenCalledTimes(1);
    });

    expect(getLastSentJson(ws)).toEqual({
      kind: MessageToClientKind.Success,
      methodId: "0x129",
      methodName: "GetSomething",
      requestId: "rawui-1",
      data: 42,
    });
  });

  it("echoes a client-supplied requestId in error responses", async () => {
    const ws = createSocket();
    state.isFanControlAvailable = false;

    dispatchMessage(ws, {
      kind: MessageToServerKind.DoFixedSpeed,
      methodId: "mode-toggle",
      methodName: "SetDoFixedSpeed",
      requestId: "mode-1",
      data: true,
    });

    await vi.waitFor(() => {
      expect(ws.send).toHaveBeenCalledTimes(1);
    });

    expect(getLastSentJson(ws)).toEqual({
      kind: MessageToClientKind.Error,
      methodId: "mode-toggle",
      methodName: "SetDoFixedSpeed",
      requestId: "mode-1",
      data: "UNSUPPORTED_FEATURE: Fan control is not available on this system",
    });
  });

  it("rejects fan control mutations when the backend reports that fan control is unavailable", async () => {
    const ws = createSocket();
    state.isFanControlAvailable = false;

    dispatchMessage(ws, {
      kind: MessageToServerKind.FixedPercentage,
      methodId: "fan-unavailable",
      methodName: "SetFixedPercentage",
      data: 64,
    });

    await vi.waitFor(() => {
      expect(ws.send).toHaveBeenCalledTimes(1);
    });

    expect(state.fixedPercentage).toBe(DEFAULT_STATE.fixedPercentage);
    expect(mockedApplyFixedFan).not.toHaveBeenCalled();
    expect(getLastSentJson(ws)).toEqual({
      kind: MessageToClientKind.Error,
      methodId: "fan-unavailable",
      methodName: "SetFixedPercentage",
      data: "UNSUPPORTED_FEATURE: Fan control is not available on this system",
    });
  });

  it("rejects enabling fixed mode when applying the stored speed fails", async () => {
    const ws = createSocket();
    mockedApplyFixedFan.mockRejectedValueOnce(new Error("ec write failed"));

    dispatchMessage(ws, {
      kind: MessageToServerKind.DoFixedSpeed,
      methodId: "enable-fixed-speed-failed",
      methodName: "SetDoFixedSpeed",
      data: true,
    });

    await vi.waitFor(() => {
      expect(ws.send).toHaveBeenCalledTimes(1);
    });

    expect(state.doFixedSpeed).toBe(DEFAULT_STATE.doFixedSpeed);
    expect(mockedPersistState).not.toHaveBeenCalled();
    expect(server.publish).not.toHaveBeenCalled();
    expect(getLastSentJson(ws)).toEqual({
      kind: MessageToClientKind.Error,
      methodId: "enable-fixed-speed-failed",
      methodName: "SetDoFixedSpeed",
      data: "INTERNAL_ERROR: An unexpected error occurred",
    });
  });

  it("rejects invalid fixedpercentage ranges", async () => {
    const ws = createSocket();

    dispatchMessage(ws, {
      kind: MessageToServerKind.FixedPercentage,
      methodId: "fixed-out-of-range",
      methodName: "SetFixedPercentage",
      data: 140,
    });

    await vi.waitFor(() => {
      expect(ws.send).toHaveBeenCalledTimes(1);
    });

    expect(state.fixedPercentage).toBe(DEFAULT_STATE.fixedPercentage);
    expect(getLastSentJson(ws)).toEqual({
      kind: MessageToClientKind.Error,
      methodId: "fixed-out-of-range",
      methodName: "SetFixedPercentage",
      data: "INVALID_RANGE: fixedpercentage must be an integer from 0 to 100",
    });
  });

  it("rejects invalid fan tables", async () => {
    const ws = createSocket();

    dispatchMessage(ws, {
      kind: MessageToServerKind.FanTable,
      methodId: "fan-table-invalid",
      methodName: "SetFanTable",
      data: {
        cpu: [
          [80, 70],
          [60, 60],
        ],
        gpu: [
          [40, 15],
          [80, 65],
        ],
      },
    });

    await vi.waitFor(() => {
      expect(ws.send).toHaveBeenCalledTimes(1);
    });

    expect(state.cpuFanTable).toEqual(DEFAULT_STATE.cpuFanTable);
    expect(getLastSentJson(ws)).toEqual({
      kind: MessageToClientKind.Error,
      methodId: "fan-table-invalid",
      methodName: "SetFanTable",
      data: "INVALID_PAYLOAD: fantable requires ascending CPU and GPU tables with percentages from 0 to 100",
    });
  });

  it("rejects GPU boost mutations when the backend reports the feature unavailable", async () => {
    const ws = createSocket();
    state.isGpuBoostAvailable = false;

    dispatchMessage(ws, {
      kind: MessageToServerKind.Set,
      methodId: "gpu-boost-unavailable",
      methodName: "SetAIBoostStatus",
      data: { Data: 0 },
    });

    await vi.waitFor(() => {
      expect(ws.send).toHaveBeenCalledTimes(1);
    });

    expect(mockedSetCall).not.toHaveBeenCalled();
    expect(state.gpuBoost).toBe(DEFAULT_STATE.gpuBoost);
    expect(getLastSentJson(ws)).toEqual({
      kind: MessageToClientKind.Error,
      methodId: "gpu-boost-unavailable",
      methodName: "SetAIBoostStatus",
      data: "UNSUPPORTED_FEATURE: GPU boost is not available on this system",
    });
  });

  it("returns INVALID_JSON for malformed payloads", async () => {
    const ws = createSocket();

    dispatchMessage(ws, "{bad json");

    await vi.waitFor(() => {
      expect(ws.send).toHaveBeenCalledTimes(1);
    });

    expect(getLastSentJson(ws)).toEqual({
      kind: MessageToClientKind.Error,
      data: "INVALID_JSON: Failed to parse message",
    });
  });

  it("returns UNKNOWN_KIND while preserving method metadata", async () => {
    const ws = createSocket();

    dispatchMessage(
      ws,
      JSON.stringify({
        kind: "unknown-kind",
        methodId: "unknown-kind",
        methodName: "UnknownKind",
      }),
    );

    await vi.waitFor(() => {
      expect(ws.send).toHaveBeenCalledTimes(1);
    });

    expect(getLastSentJson(ws)).toEqual({
      kind: MessageToClientKind.Error,
      methodId: "unknown-kind",
      methodName: "UnknownKind",
      data: "UNKNOWN_KIND: unknown-kind",
    });
  });

  it.each([
    MessageToServerKind.FixedPercentage,
    MessageToServerKind.DoFixedSpeed,
    MessageToServerKind.FanTable,
    MessageToServerKind.Tune,
    MessageToServerKind.Set,
  ])("returns MISSING_DATA for %s without payload data", async (kind) => {
    const ws = createSocket();

    dispatchMessage(
      ws,
      JSON.stringify({
        kind,
        methodId: `${kind}-missing-data`,
        methodName: "MissingDataCase",
      }),
    );

    await vi.waitFor(() => {
      expect(ws.send).toHaveBeenCalledTimes(1);
    });

    expect(getLastSentJson(ws)).toEqual({
      kind: MessageToClientKind.Error,
      methodId: `${kind}-missing-data`,
      methodName: "MissingDataCase",
      data: `MISSING_DATA: ${kind}`,
    });
  });
});
