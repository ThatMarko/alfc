import type {
  FanTable,
  MessageToClient,
  MessageToServer,
  State,
} from "../../common/types.js";
import {
  MessageToClientKind,
  MessageToServerKind,
} from "../../common/types.js";
import { fanControl, setFixedFan } from "../fan-control/index.js";
import { getCall, setCall, tune } from "../native/index.js";
import { persistState, state } from "../state/index.js";
import { websocketHandlers } from "./index.js";

vi.mock("../native/index.js", () => ({
  getCall: vi.fn(),
  setCall: vi.fn().mockResolvedValue(undefined),
  tune: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../fan-control/index.js", () => ({
  setFixedFan: vi.fn(),
  fanControl: vi.fn(),
}));

vi.mock("../state/index.js", () => ({
  state: {
    protocolVersion: "1.0",
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
const mockedSetFixedFan = vi.mocked(setFixedFan);
const mockedAutoFanControl = vi.mocked(fanControl);

const DEFAULT_STATE: State = {
  protocolVersion: "1.0",
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
}

function createSocket(): MockSocket {
  return {
    send: vi.fn(),
    subscribe: vi.fn(),
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

describe("websocket contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStateToDefaults();
    mockedGetCall.mockResolvedValue("0x0");
    mockedSetCall.mockResolvedValue(undefined);
    mockedTune.mockResolvedValue(undefined);
    mockedPersistState.mockResolvedValue(undefined);
  });

  it("sends a protocol versioned state snapshot on open", () => {
    const ws = createSocket();

    websocketHandlers.open(
      ws as unknown as import("bun").ServerWebSocket<unknown>,
    );

    const message = getLastSentJson(ws);
    expect(message.kind).toBe(MessageToClientKind.State);
    expect(message.data).toEqual({
      ...state,
      protocolVersion: "1.0",
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
    expect(mockedSetFixedFan).toHaveBeenCalledWith(64);
    expect(mockedPersistState).toHaveBeenCalledTimes(1);
    expect(getLastSentJson(ws)).toEqual({
      kind: MessageToClientKind.Success,
      methodId: "fixed-percentage",
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
    expect(getLastSentJson(ws)).toEqual({
      kind: MessageToClientKind.Success,
      methodId: "do-fixed-speed",
      methodName: "SetDoFixedSpeed",
      data: false,
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
    mockedGetCall.mockResolvedValueOnce("0x2a");

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
      data: "0x2a",
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
    expect(getLastSentJson(ws)).toEqual({
      kind: MessageToClientKind.Success,
      methodId: "129",
      methodName: "SetAIBoostStatus",
      data: { Data: 0 },
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
