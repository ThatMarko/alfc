const transportState = {
  activeCalls: 0,
  maxActiveCalls: 0,
  operations: [] as string[],
  failMethod: "",
  failureListener: null as
    null | ((channel: "wmi" | "cpuoc", error: Error) => void),
};
const realProcess = process;
const platforms = ["linux", "win32"] as const;

async function runTransportCall<T>(methodName: string, result: T) {
  transportState.activeCalls += 1;
  transportState.maxActiveCalls = Math.max(
    transportState.maxActiveCalls,
    transportState.activeCalls,
  );
  transportState.operations.push(`start:${methodName}`);

  try {
    await Promise.resolve();

    if (transportState.failMethod === methodName) {
      throw new Error(`${methodName} failed`);
    }

    return result;
  } finally {
    transportState.operations.push(`end:${methodName}`);
    transportState.activeCalls -= 1;
  }
}

function acpiModuleFactory() {
  return {
    getCall: vi.fn((_: string, methodName: string) =>
      runTransportCall(methodName, 42),
    ),
    isAvailable: vi.fn(() => Promise.resolve(true)),
    setCall: vi.fn((_: string, methodName: string) =>
      runTransportCall(methodName, undefined),
    ),
    wmiCleanup: vi.fn(),
    wmiInit: vi.fn(() => Promise.resolve()),
    onHardwareFailure: vi.fn(
      (listener: (channel: "wmi" | "cpuoc", error: Error) => void) => {
        transportState.failureListener = listener;
        return () => {
          transportState.failureListener = null;
        };
      },
    ),
  };
}

function cpuOcModuleFactory() {
  return {
    cpuocCleanup: vi.fn(),
    tuneInit: vi.fn(() => Promise.resolve()),
    tune: vi.fn((pl1: number, pl2: number) =>
      runTransportCall(`tune:${pl1}:${pl2}`, undefined),
    ),
  };
}

vi.mock("./linux/acpi", acpiModuleFactory);
vi.mock("./linux/cpuoc", cpuOcModuleFactory);
vi.mock("./windows/hardware", () => {
  // Windows initializes COM through wmiInit, rather than the Linux-only
  // availability probe. Keep this shape faithful to the real worker adapter.
  const { isAvailable: _isAvailable, ...acpi } = acpiModuleFactory();
  return { ...acpi, ...cpuOcModuleFactory(), isAvailable: undefined };
});
vi.mock("../fan-control/index", () => ({
  fanControl: vi.fn(() => Promise.resolve()),
  restoreAutoFanControl: vi.fn(() => Promise.resolve()),
  cleanupFanControlIntervals: vi.fn(),
}));
vi.mock("../websocket/index", () => ({ publishState: vi.fn() }));
vi.mock("../state/index", () => ({
  state: {
    pl1: 37,
    pl2: 106,
    gpuBoost: true,
  },
}));

describe.each(platforms)("native services on %s", (platform) => {
  beforeEach(async () => {
    transportState.activeCalls = 0;
    transportState.maxActiveCalls = 0;
    transportState.operations = [];
    transportState.failMethod = "";
    transportState.failureListener = null;
    vi.resetModules();
    vi.resetAllMocks();
    vi.stubGlobal(
      "process",
      new Proxy(realProcess, {
        get(target, property, receiver) {
          return property === "platform"
            ? platform
            : Reflect.get(target, property, receiver);
        },
      }),
    );
    const { state } = await import("../state/index");
    Object.assign(state, {
      pl1: 37,
      pl2: 106,
      gpuBoost: true,
      isFanControlAvailable: undefined,
      isCpuTuningAvailable: undefined,
      isGpuBoostAvailable: undefined,
      restartRequired: undefined,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function getAcpiAdapter() {
    return platform === "linux"
      ? import("./linux/acpi")
      : import("./windows/hardware");
  }

  function getCpuAdapter() {
    return platform === "linux"
      ? import("./linux/cpuoc")
      : import("./windows/hardware");
  }

  it("keeps ACPI polling and the BIOS shutdown drain responsive during CPU tuning", async () => {
    const native = await import("./index");
    const cpuoc = await getCpuAdapter();
    let release: () => void = () => {};
    vi.mocked(cpuoc.tune).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const tune = native.tune(37, 106);
    await Promise.resolve();
    await expect(native.getCall("225", "getCpuTemp")).resolves.toBe(42);
    await native.drainNativeCalls();
    release();
    await tune;
  });

  it("downgrades only the failed hardware channel and publishes authoritative capabilities", async () => {
    await import("./index");
    const { state } = await import("../state/index");
    const { publishState } = await import("../websocket/index");
    const { cleanupFanControlIntervals } = await import("../fan-control/index");
    state.isFanControlAvailable = true;
    state.isGpuBoostAvailable = true;
    state.isCpuTuningAvailable = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    transportState.failureListener?.(
      "cpuoc",
      new Error("CPU tuning timed out"),
    );
    expect(state.isCpuTuningAvailable).toBe(false);
    expect(state.restartRequired).toBe(true);
    expect(state.isFanControlAvailable).toBe(true);
    expect(state.isGpuBoostAvailable).toBe(true);
    transportState.failureListener?.("wmi", new Error("WMI timed out"));
    expect(state.isFanControlAvailable).toBe(false);
    expect(state.isGpuBoostAvailable).toBe(false);
    expect(cleanupFanControlIntervals).toHaveBeenCalledOnce();
    expect(publishState).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });

  it("probes GPU boost independently after managed fan initialization fails", async () => {
    const native = await import("./index");
    const fan = await import("../fan-control/index");
    const { state } = await import("../state/index");
    vi.mocked(fan.fanControl).mockRejectedValueOnce(
      new Error("Unsupported fan setup method"),
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await native.initNativeServices();
    expect(state.isFanControlAvailable).toBe(false);
    expect(state.isGpuBoostAvailable).toBe(true);
    expect(fan.restoreAutoFanControl).toHaveBeenCalledOnce();
    expect(transportState.operations).toContain("start:SetAIBoostStatus");
    log.mockRestore();
    warn.mockRestore();
  });

  it("captures explicit and configured tune limits before waiting in the queue", async () => {
    const native = await import("./index");
    const { state } = await import("../state/index");
    const configured = native.tune();
    const explicit = native.tune(45, 95);
    state.pl1 = 99;
    state.pl2 = 100;
    await Promise.all([configured, explicit]);
    expect(transportState.operations).toEqual([
      "start:tune:37:106",
      "end:tune:37:106",
      "start:tune:45:95",
      "end:tune:45:95",
    ]);
  });

  it("initializes the selected platform backend before enabling hardware capabilities", async () => {
    const native = await import("./index");
    const acpi = await getAcpiAdapter();
    const cpuoc = await getCpuAdapter();
    const { state } = await import("../state/index");
    vi.spyOn(console, "log").mockImplementation(() => {});

    await native.initNativeServices();

    expect(acpi.wmiInit).toHaveBeenCalledTimes(platform === "win32" ? 1 : 0);
    if (platform === "linux") {
      const linux = await import("./linux/acpi");
      expect(linux.isAvailable).toHaveBeenCalledOnce();
    }
    expect(cpuoc.tuneInit).toHaveBeenCalledOnce();
    expect(state.isFanControlAvailable).toBe(true);
    expect(state.isCpuTuningAvailable).toBe(true);
    expect(state.isGpuBoostAvailable).toBe(true);
  });

  it("stops startup when shutdown begins during the platform backend probe", async () => {
    const native = await import("./index");
    const cpuoc = await getCpuAdapter();
    const fan = await import("../fan-control/index");
    let started: () => void = () => {};
    let release: () => void = () => {};
    const probeStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const probeResult = new Promise<void>((resolve) => {
      release = resolve;
    });
    const probe = () => {
      started();
      return probeResult;
    };
    if (platform === "linux") {
      const acpi = await import("./linux/acpi");
      vi.mocked(acpi.isAvailable).mockImplementationOnce(() =>
        probe().then(() => true),
      );
    } else {
      const hardware = await import("./windows/hardware");
      vi.mocked(hardware.wmiInit).mockImplementationOnce(probe);
    }
    vi.spyOn(console, "log").mockImplementation(() => {});
    let stopped = false;
    const startup = native.initNativeServices(() => stopped);
    await probeStarted;
    stopped = true;
    release();
    await startup;
    expect(fan.fanControl).not.toHaveBeenCalled();
    expect(cpuoc.tuneInit).not.toHaveBeenCalled();
    expect(transportState.operations).toEqual([]);
  });

  it("drains pending calls before cleanup and rejects new calls afterwards", async () => {
    const native = await import("./index");
    const acpi = await getAcpiAdapter();
    const first = native.getCall("225", "getCpuTemp");
    const cleanup = native.cleanupNativeServices();
    await expect(
      native.setCall("107", "SetFixedFanSpeed", { Data: 100 }),
    ).rejects.toThrow("closed");
    await first;
    await cleanup;
    expect(acpi.wmiCleanup).toHaveBeenCalledOnce();
    expect(transportState.operations).toEqual([
      "start:getCpuTemp",
      "end:getCpuTemp",
    ]);
  });

  it("serializes ACPI get/set calls on the shared transport", async () => {
    const native = await import("./index");

    const [cpuTemp, , gpuTemp] = await Promise.all([
      native.getCall("0xe1", "getCpuTemp"),
      native.setCall("0x6b", "SetFixedFanSpeed", { Data: 120 }),
      native.getCall("0xe2", "getGpuTemp1"),
    ]);

    expect(cpuTemp).toBe(42);
    expect(gpuTemp).toBe(42);
    expect(transportState.maxActiveCalls).toBe(1);
    expect(transportState.operations).toEqual([
      "start:getCpuTemp",
      "end:getCpuTemp",
      "start:SetFixedFanSpeed",
      "end:SetFixedFanSpeed",
      "start:getGpuTemp1",
      "end:getGpuTemp1",
    ]);
  });

  it("continues processing queued calls after a native failure", async () => {
    transportState.failMethod = "SetFixedFanSpeed";
    const native = await import("./index");

    await expect(
      native.setCall("0x6b", "SetFixedFanSpeed", { Data: 120 }),
    ).rejects.toThrow("SetFixedFanSpeed failed");
    await expect(native.getCall("0xe1", "getCpuTemp")).resolves.toBe(42);

    expect(transportState.maxActiveCalls).toBe(1);
    expect(transportState.operations).toEqual([
      "start:SetFixedFanSpeed",
      "end:SetFixedFanSpeed",
      "start:getCpuTemp",
      "end:getCpuTemp",
    ]);
  });
});
