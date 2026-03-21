const transportState = {
  activeCalls: 0,
  maxActiveCalls: 0,
  operations: [] as string[],
  failMethod: "",
};

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
    wmiInit: vi.fn(() => Promise.resolve()),
  };
}

function cpuOcModuleFactory() {
  return {
    tuneInit: vi.fn(() => Promise.resolve()),
    tune: vi.fn(() => Promise.resolve()),
  };
}

vi.mock("./linux/acpi", acpiModuleFactory);
vi.mock("./windows/acpi", acpiModuleFactory);
vi.mock("./linux/cpuoc", cpuOcModuleFactory);
vi.mock("./windows/cpuoc", cpuOcModuleFactory);
vi.mock("../fan-control/index", () => ({
  fanControl: vi.fn(),
}));
vi.mock("../state/index", () => ({
  state: {
    pl1: 37,
    pl2: 106,
    gpuBoost: true,
  },
}));

describe("native call queue", () => {
  beforeEach(() => {
    transportState.activeCalls = 0;
    transportState.maxActiveCalls = 0;
    transportState.operations = [];
    transportState.failMethod = "";
    vi.resetModules();
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
