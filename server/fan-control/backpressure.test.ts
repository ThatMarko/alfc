import { state } from "../state/index";

const platform = vi.hoisted(() => ({
  getCall: vi.fn<() => Promise<number>>(),
  setCall: vi.fn<(_id: string, _name: string) => Promise<void>>(),
}));

vi.mock("../native/linux/acpi", () => ({
  ...platform,
  isAvailable: () => Promise.resolve(true),
  wmiInit: () => Promise.resolve(),
  wmiCleanup: () => {},
  onHardwareFailure: undefined,
}));
vi.mock("../native/linux/cpuoc", () => ({
  tuneInit: () => Promise.resolve(),
  tune: () => Promise.resolve(),
  cpuocCleanup: () => {},
}));
vi.mock("../state/index", () => ({
  state: {
    cpuFanTable: [
      [40, 15],
      [80, 100],
    ],
    gpuFanTable: [
      [40, 15],
      [80, 100],
    ],
    doFixedSpeed: true,
    fixedPercentage: 50,
  },
}));
vi.mock("../websocket/index", () => ({
  publishActivity: vi.fn(),
  publishState: vi.fn(),
}));

describe("fan monitoring through the real native queue", () => {
  const realProcess = process;
  let releaseRead: (() => void) | undefined;
  let fan: typeof import("./index");

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    // This fixture replaces only Linux's physical transport. Keep that
    // selection explicit on Windows CI as well, before importing native.
    vi.stubGlobal(
      "process",
      new Proxy(realProcess, {
        get(target, property, receiver) {
          return property === "platform"
            ? "linux"
            : Reflect.get(target, property, receiver);
        },
      }),
    );
    platform.setCall.mockResolvedValue(undefined);
    platform.getCall.mockResolvedValue(42);
    platform.getCall.mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          releaseRead = () => resolve(42);
        }),
    );
    fan = await import("./index");
    state.doFixedSpeed = true;
    state.fixedPercentage = 50;
  });

  afterEach(async () => {
    fan?.startFanControlShutdown();
    releaseRead?.();
    releaseRead = undefined;
    await vi.advanceTimersByTimeAsync(0);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not queue timed-out sensor reads for a later burst", async () => {
    const { publishActivity } = await import("../websocket/index");
    await fan.fanControl();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(platform.getCall).toHaveBeenCalledTimes(1);

    // Real native calls are serialized. Counting calls before release hides
    // an arbitrarily long queue, so also observe the drain after recovery.
    releaseRead?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(platform.getCall).toHaveBeenCalledTimes(1);
    expect(publishActivity).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(fan.CYCLE_DURATION);
    expect(platform.getCall).toHaveBeenCalledTimes(4);
    expect(publishActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({
        avgCPUTemp: 42,
        sensorFailure: false,
        appliedSpeed: 50,
      }),
    );
  });

  it("keeps only one periodic reinitialization outstanding on a held channel", async () => {
    await fan.fanControl();
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    releaseRead?.();
    await vi.advanceTimersByTimeAsync(0);
    // One startup and one pending maintenance sequence; not three old
    // five-minute sequences all replayed when the channel finally responds.
    const starts = platform.setCall.mock.calls.filter(
      ([, name]) => name === "SetSuperQuiet",
    );
    expect(starts).toHaveLength(2);
  });
});
