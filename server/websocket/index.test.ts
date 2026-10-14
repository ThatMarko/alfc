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
import {
  publishActivity,
  publishState,
  setServer,
  setServers,
  startWebSocketShutdown,
  websocketHandlers,
} from "./index";

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

type MockServer = ReturnType<typeof createServer>;

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
  delete state.restartRequired;
}

function createSocket(): MockSocket {
  return {
    send: vi.fn(),
    subscribe: vi.fn(),
  };
}

function createServer() {
  return {
    publish: vi
      .fn<import("bun").Server<unknown>["publish"]>()
      .mockReturnValue(0),
  };
}

function dispatchMessage(
  ws: MockSocket,
  payload: MessageToServer | string | Buffer,
) {
  return websocketHandlers.message(
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

  it("synchronizes state and telemetry across both loopback listeners", async () => {
    const ipv6 = createServer();
    setServers([server, ipv6]);
    const ws = createSocket();
    await dispatchMessage(ws, {
      kind: MessageToServerKind.FixedPercentage,
      data: 72,
    });
    const activity = {
      appliedSpeed: 72,
      avgCPUTemp: 65,
      avgGPUTemp: 60,
      target: 72,
      sensorFailure: false,
    };
    publishActivity(activity);
    for (const listener of [server, ipv6]) {
      expect(listener.publish).toHaveBeenCalledTimes(2);
      expect(listener.publish).toHaveBeenNthCalledWith(
        1,
        "state",
        expect.any(String),
      );
      expect(
        JSON.parse(String(listener.publish.mock.calls[0]?.[1])).data
          .fixedPercentage,
      ).toBe(72);
      expect(listener.publish).toHaveBeenNthCalledWith(
        2,
        "activity",
        JSON.stringify({
          kind: MessageToClientKind.FanControlActivity,
          data: activity,
        }),
      );
    }
    expect(server.publish.mock.calls).toEqual(ipv6.publish.mock.calls);
  });

  it("publishes once per listener and replaces the registry for a single server", () => {
    const other = createServer();
    setServers([server, server, other]);
    publishState();
    expect(server.publish).toHaveBeenCalledTimes(1);
    expect(other.publish).toHaveBeenCalledTimes(1);
    server.publish.mockClear();
    other.publish.mockClear();
    setServer(server as unknown as import("bun").Server<unknown>);
    publishState();
    expect(server.publish).toHaveBeenCalledTimes(1);
    expect(other.publish).not.toHaveBeenCalled();
    setServers([]);
    publishState();
    expect(server.publish).toHaveBeenCalledTimes(1);
  });

  it("broadcasts runtime capability changes to every connected client", async () => {
    state.isCpuTuningAvailable = false;
    state.restartRequired = true;
    publishState();
    expect(getLastPublishedJson(server)).toEqual({
      kind: MessageToClientKind.State,
      data: { ...state, protocolVersion: "1.1" },
    });
    const ws = createSocket();
    websocketHandlers.open(
      ws as unknown as import("bun").ServerWebSocket<unknown>,
    );
    expect(getLastSentJson(ws).data).toMatchObject({
      restartRequired: true,
      isCpuTuningAvailable: false,
      isFanControlAvailable: true,
    });
    await dispatchMessage(ws, {
      kind: MessageToServerKind.Tune,
      requestId: "after-native-failure",
      data: { pl1: 40, pl2: 90 },
    });
    expect(mockedTune).not.toHaveBeenCalled();
    expect(getLastSentJson(ws).data).toBe(
      "UNSUPPORTED_FEATURE: CPU tuning is not available on this system",
    );
    expect(state.isFanControlAvailable).toBe(true);
  });

  it("preserves restart-required fatal errors through fan-write wrappers", async () => {
    const ws = createSocket();
    const fatal = Object.assign(
      new Error("WMI worker timed out; restart ALFC to recover safely"),
      { restartRequired: true },
    );
    mockedApplyFixedFan.mockRejectedValueOnce(
      new Error("SetFixedFanSpeed failed", { cause: fatal }),
    );
    await dispatchMessage(ws, {
      kind: MessageToServerKind.DoFixedSpeed,
      requestId: "fatal-fan-write",
      data: true,
    });
    expect(getLastSentJson(ws)).toEqual({
      kind: MessageToClientKind.Error,
      requestId: "fatal-fan-write",
      data: "RESTART_REQUIRED: WMI worker timed out; restart ALFC to recover safely",
    });
    expect(state.doFixedSpeed).toBe(false);
    expect(mockedPersistState).not.toHaveBeenCalled();
  });

  it("emits one restart-required code when a native adapter already prefixes it", async () => {
    const ws = createSocket();
    mockedTune.mockRejectedValueOnce(
      Object.assign(
        new Error(
          "RESTART_REQUIRED: RESTART_REQUIRED: Windows cpuoc hardware failed",
        ),
        { restartRequired: true },
      ),
    );
    await dispatchMessage(ws, {
      kind: MessageToServerKind.Tune,
      requestId: "cpu-fatal",
      data: { pl1: 40, pl2: 90 },
    });
    expect(getLastSentJson(ws).data).toBe(
      "RESTART_REQUIRED: Windows cpuoc hardware failed",
    );
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

  it("disables fixed mode without restarting the active monitoring loop", async () => {
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
    expect(mockedAutoFanControl).not.toHaveBeenCalled();
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
      methodId: "0x59",
      methodName: "GetLightBar",
      data: { Index: 1 },
    });

    await vi.waitFor(() => {
      expect(ws.send).toHaveBeenCalledTimes(1);
    });

    expect(mockedGetCall).toHaveBeenCalledWith("89", "GetLightBar", {
      Index: 1,
    });
    expect(getLastSentJson(ws)).toEqual({
      kind: MessageToClientKind.Success,
      methodId: "0x59",
      methodName: "GetLightBar",
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

  it("keeps tune settings authoritative until hardware accepts them and serializes clients", async () => {
    const first = createSocket();
    const second = createSocket();
    let rejectFirst: ((reason: Error) => void) | undefined;
    mockedTune.mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          rejectFirst = reject;
        }),
    );
    dispatchMessage(first, {
      kind: MessageToServerKind.Tune,
      data: { pl1: 45, pl2: 95 },
    });
    dispatchMessage(second, {
      kind: MessageToServerKind.Tune,
      data: { pl1: 50, pl2: 100 },
    });
    await vi.waitFor(() => expect(mockedTune).toHaveBeenCalledTimes(1));
    const newlyConnected = createSocket();
    websocketHandlers.open(
      newlyConnected as unknown as import("bun").ServerWebSocket<unknown>,
    );
    expect(getLastSentJson(newlyConnected).data).toMatchObject({
      pl1: 37,
      pl2: 106,
    });
    expect(server.publish).not.toHaveBeenCalled();
    rejectFirst?.(new Error("hardware rejected limits"));
    await vi.waitFor(() => expect(second.send).toHaveBeenCalledTimes(1));
    expect(mockedTune).toHaveBeenNthCalledWith(1, 45, 95);
    expect(mockedTune).toHaveBeenNthCalledWith(2, 50, 100);
    expect(state.pl1).toBe(50);
    expect(state.pl2).toBe(100);
    expect(getLastSentJson(first).kind).toBe(MessageToClientKind.Error);
    expect(getLastSentJson(second).kind).toBe(MessageToClientKind.Success);
  });

  it("acknowledges configuration only after it is saved", async () => {
    const ws = createSocket();
    let resolveSave: (() => void) | undefined;
    mockedPersistState.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    dispatchMessage(ws, {
      kind: MessageToServerKind.FixedPercentage,
      data: 60,
    });
    await vi.waitFor(() => expect(mockedPersistState).toHaveBeenCalledTimes(1));
    expect(ws.send).not.toHaveBeenCalled();
    resolveSave?.();
    await vi.waitFor(() =>
      expect(getLastSentJson(ws).kind).toBe(MessageToClientKind.Success),
    );
  });

  it("publishes the real active configuration and reports a failed durable save", async () => {
    const ws = createSocket();
    mockedPersistState.mockRejectedValueOnce(new Error("disk full"));
    dispatchMessage(ws, {
      kind: MessageToServerKind.FixedPercentage,
      requestId: "save-1",
      data: 65,
    });
    await vi.waitFor(() => expect(ws.send).toHaveBeenCalledTimes(1));
    expect(state.fixedPercentage).toBe(65);
    expect(getLastPublishedJson(server).data).toMatchObject({
      fixedPercentage: 65,
    });
    expect(getLastSentJson(ws)).toEqual({
      kind: MessageToClientKind.Error,
      requestId: "save-1",
      data: "PERSISTENCE_ERROR: Configuration is active but could not be saved",
    });
  });

  it.each([
    { methodId: "129", methodName: "SetBrightness", data: { Data: 1 } },
    { methodId: "129 0 0", methodName: "SetAIBoostStatus", data: { Data: 1 } },
    { methodId: "129\n", methodName: "SetAIBoostStatus", data: { Data: 1 } },
    { methodId: "129", methodName: "__proto__", data: {} },
    { methodId: "129", methodName: "SetAIBoostStatus", data: { Data: 1.5 } },
    { methodId: "129", methodName: "SetAIBoostStatus", data: { Data: -1 } },
    { methodId: "129", methodName: "SetAIBoostStatus", data: { Data: 256 } },
    { methodId: "129", methodName: "SetAIBoostStatus", data: { Wrong: 1 } },
    {
      methodId: "129",
      methodName: "SetAIBoostStatus",
      data: { Data: 1, Extra: 0 },
    },
  ])(
    "rejects mismatched native methods or invalid arguments: %j",
    async (call) => {
      const ws = createSocket();
      dispatchMessage(ws, { kind: MessageToServerKind.Set, ...call });
      await vi.waitFor(() => expect(ws.send).toHaveBeenCalledTimes(1));
      expect(mockedSetCall).not.toHaveBeenCalled();
      expect(getLastSentJson(ws).kind).toBe(MessageToClientKind.Error);
    },
  );

  it("orders arguments by the documented signature for Linux and Windows parity", async () => {
    const ws = createSocket();
    dispatchMessage(ws, {
      kind: MessageToServerKind.Set,
      methodId: "131",
      methodName: "SetRGBLed",
      data: { Blue: 6, Red: 4, Mode: 2, Green: 5, Area: 1, Brightness: 3 },
    });
    await vi.waitFor(() => expect(ws.send).toHaveBeenCalledTimes(1));
    const args = mockedSetCall.mock.calls[0]?.[2];
    expect(Object.keys(args ?? {})).toEqual([
      "Area",
      "Mode",
      "Brightness",
      "Red",
      "Green",
      "Blue",
    ]);
  });

  it("rejects raw fan writes that bypass authoritative managed control", async () => {
    const ws = createSocket();
    dispatchMessage(ws, {
      kind: MessageToServerKind.Set,
      methodId: "107",
      methodName: "SetFixedFanSpeed",
      data: { Data: 20 },
    });
    await vi.waitFor(() => expect(ws.send).toHaveBeenCalledTimes(1));
    expect(mockedSetCall).not.toHaveBeenCalled();
    expect(getLastSentJson(ws).data).toBe(
      "MANAGED_FAN_CONTROL: Use the fan mode, percentage, and curve commands",
    );
  });

  it("does not reflect arbitrary request properties or non-string metadata", async () => {
    const ws = createSocket();
    dispatchMessage(
      ws,
      JSON.stringify({
        kind: MessageToServerKind.FixedPercentage,
        methodName: 1,
        requestId: "ours",
        extra: "untrusted",
        data: 70,
      }),
    );
    await vi.waitFor(() => expect(ws.send).toHaveBeenCalledTimes(1));
    expect(getLastSentJson(ws)).toEqual({
      kind: MessageToClientKind.Success,
      requestId: "ours",
      data: 70,
    });
  });

  it("preserves packed native results larger than the exact integer range", async () => {
    const ws = createSocket();
    mockedGetCall.mockResolvedValueOnce("1208925819614629174706175");
    await dispatchMessage(ws, {
      kind: MessageToServerKind.Get,
      methodId: "96",
      methodName: "GetDeepFan",
    });
    expect(getLastSentJson(ws).data).toBe("1208925819614629174706175");
  });

  it("bounds pending work while still answering keepalive pings", async () => {
    const ws = createSocket();
    let release: (() => void) | undefined;
    mockedTune.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const requests = [
      dispatchMessage(ws, {
        kind: MessageToServerKind.Tune,
        data: { pl1: 45, pl2: 95 },
      }),
    ];
    await vi.waitFor(() => expect(mockedTune).toHaveBeenCalledTimes(1));
    for (let index = 0; index < 63; index++) {
      requests.push(
        dispatchMessage(ws, {
          kind: MessageToServerKind.FixedPercentage,
          data: index,
        }),
      );
    }
    await dispatchMessage(ws, {
      kind: MessageToServerKind.FixedPercentage,
      requestId: "busy",
      data: 90,
    });
    expect(getLastSentJson(ws)).toEqual({
      kind: MessageToClientKind.Error,
      requestId: "busy",
      data: "BUSY: Too many pending requests",
    });
    const subscriber = createSocket();
    await dispatchMessage(subscriber, {
      kind: MessageToServerKind.RegisterActivitySocket,
    });
    expect(subscriber.subscribe).toHaveBeenCalledWith("activity");
    expect(subscriber.send).not.toHaveBeenCalled();
    await dispatchMessage(ws, "ping");
    expect(ws.send).toHaveBeenLastCalledWith("pong");
    release?.();
    await Promise.all(requests);
    expect(state.fixedPercentage).toBe(62);
  });

  it("echoes a client-supplied requestId in success responses", async () => {
    const ws = createSocket();
    mockedGetCall.mockResolvedValueOnce(42);

    dispatchMessage(ws, {
      kind: MessageToServerKind.Get,
      methodId: "0x59",
      methodName: "GetLightBar",
      requestId: "rawui-1",
      data: { Index: 1 },
    });

    await vi.waitFor(() => {
      expect(ws.send).toHaveBeenCalledTimes(1);
    });

    expect(getLastSentJson(ws)).toEqual({
      kind: MessageToClientKind.Success,
      methodId: "0x59",
      methodName: "GetLightBar",
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
      methodId: "129",
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
      methodId: "129",
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

  it("accepts valid UTF-8 binary JSON and binary heartbeats", async () => {
    const ws = createSocket();
    await dispatchMessage(
      ws,
      Buffer.from(
        JSON.stringify({
          kind: MessageToServerKind.FixedPercentage,
          requestId: "binary-温度-🌡",
          data: 70,
        }),
      ),
    );
    expect(state.fixedPercentage).toBe(70);
    expect(getLastSentJson(ws)).toEqual({
      kind: MessageToClientKind.Success,
      requestId: "binary-温度-🌡",
      data: 70,
    });
    await dispatchMessage(ws, Buffer.from("ping"));
    expect(ws.send).toHaveBeenLastCalledWith("pong");
  });

  it.each([[0xff], [0xc0, 0xaf], [0xf4, 0x90, 0x80, 0x80], [0xe2, 0x82]])(
    "rejects corrupted UTF-8 binary JSON before admitting a mutation: %j",
    async (...bytes) => {
      const ws = createSocket();
      await dispatchMessage(
        ws,
        Buffer.concat([
          Buffer.from(
            '{"kind":"fixedpercentage","data":70,"requestId":"binary-',
          ),
          Buffer.from(bytes),
          Buffer.from('"}'),
        ]),
      );
      expect(getLastSentJson(ws)).toEqual({
        kind: MessageToClientKind.Error,
        data: "INVALID_JSON: Failed to parse message",
      });
      expect(state.fixedPercentage).toBe(DEFAULT_STATE.fixedPercentage);
      expect(mockedPersistState).not.toHaveBeenCalled();
      expect(server.publish).not.toHaveBeenCalled();
      // A failed decode must not leave the shared decoder in a streaming state.
      await dispatchMessage(
        ws,
        Buffer.from(JSON.stringify({ kind: "fixedpercentage", data: 65 })),
      );
      expect(state.fixedPercentage).toBe(65);
      expect(getLastSentJson(ws).kind).toBe(MessageToClientKind.Success);
    },
  );

  it("rejects a binary BOM consistently with a text JSON message", async () => {
    const ws = createSocket();
    await dispatchMessage(
      ws,
      Buffer.from('\uFEFF{"kind":"fixedpercentage","data":70}'),
    );
    expect(getLastSentJson(ws)).toEqual({
      kind: MessageToClientKind.Error,
      data: "INVALID_JSON: Failed to parse message",
    });
    expect(mockedPersistState).not.toHaveBeenCalled();
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

  it("returns a structured rejection for an object kind that cannot be coerced to a string", async () => {
    const ws = createSocket();
    await expect(
      dispatchMessage(
        ws,
        JSON.stringify({
          kind: { toString: null, valueOf: null },
          requestId: "invalid-kind-object",
        }),
      ),
    ).resolves.toBeUndefined();
    expect(getLastSentJson(ws)).toEqual({
      kind: MessageToClientKind.Error,
      requestId: "invalid-kind-object",
      data: "UNKNOWN_KIND: object",
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

  it("drains admitted work and prevents queued mutations during shutdown", async () => {
    const active = createSocket();
    const queued = createSocket();
    let release: (() => void) | undefined;
    mockedTune.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const first = dispatchMessage(active, {
      kind: MessageToServerKind.Tune,
      data: { pl1: 45, pl2: 95 },
    });
    await vi.waitFor(() => expect(mockedTune).toHaveBeenCalledTimes(1));
    const second = dispatchMessage(queued, {
      kind: MessageToServerKind.FixedPercentage,
      requestId: "queued",
      data: 80,
    });
    const drained = startWebSocketShutdown();
    const rejected = createSocket();
    await dispatchMessage(rejected, {
      kind: MessageToServerKind.FixedPercentage,
      methodId: "fixed",
      requestId: "after-shutdown",
      data: 90,
    });
    expect(getLastSentJson(rejected)).toEqual({
      kind: MessageToClientKind.Error,
      methodId: "fixed",
      requestId: "after-shutdown",
      data: "SHUTTING_DOWN: The server is shutting down",
    });
    release?.();
    await Promise.all([first, second, drained]);
    expect(state.pl1).toBe(45);
    expect(state.fixedPercentage).toBe(DEFAULT_STATE.fixedPercentage);
    expect(getLastSentJson(queued)).toEqual({
      kind: MessageToClientKind.Error,
      requestId: "queued",
      data: "SHUTTING_DOWN: The server is shutting down",
    });
  });
});
