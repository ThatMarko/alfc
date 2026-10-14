import type { HardwareRequest, HardwareResponse } from "./hardware-protocol";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage?: (event: MessageEvent<HardwareResponse>) => void;
  onerror?: (event: ErrorEvent) => void;
  requests: HardwareRequest[] = [];
  terminate = vi.fn();
  unref = vi.fn();

  constructor(readonly url: string) {
    FakeWorker.instances.push(this);
  }

  postMessage(request: HardwareRequest) {
    this.requests.push(request);
  }

  respond(response: HardwareResponse) {
    this.onmessage?.({ data: response } as MessageEvent<HardwareResponse>);
  }
}

describe("Windows hardware worker bridge", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    FakeWorker.instances = [];
    vi.stubGlobal("Worker", FakeWorker);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("lazily owns one worker and correlates numeric and exact large results", async () => {
    const hardware = await import("./hardware");
    expect(FakeWorker.instances).toHaveLength(0);
    const first = hardware.getCall("225", "getCpuTemp");
    const second = hardware.getCall("96", "GetDeepFan");
    const worker = FakeWorker.instances[0]!;
    expect(worker.url).toContain("hardware.worker.ts");
    expect(FakeWorker.instances).toHaveLength(1);
    worker.respond({ id: 2, ok: true, result: "1208925819614629174706175" });
    worker.respond({ id: 1, ok: true, result: 42 });
    await expect(first).resolves.toBe(42);
    await expect(second).resolves.toBe("1208925819614629174706175");
  });

  it("propagates a native rejection without disabling unrelated CPU capabilities", async () => {
    const hardware = await import("./hardware");
    const first = hardware.wmiInit();
    const worker = FakeWorker.instances[0]!;
    worker.respond({ id: 1, ok: false, error: "WMI unavailable" });
    await expect(first).rejects.toThrow("WMI unavailable");
    const tune = hardware.tune(37, 106);
    const cpuWorker = FakeWorker.instances[1]!;
    expect(cpuWorker.requests[0]?.operation).toEqual({
      kind: "tune",
      pl1: 37,
      pl2: 106,
    });
    cpuWorker.respond({ id: 1, ok: true });
    await expect(tune).resolves.toBeUndefined();
  });

  it("permanently fails and terminates a stalled worker without reusing its DLLs", async () => {
    const hardware = await import("./hardware");
    const pending = hardware.setCall("107", "SetFixedFanSpeed", { Data: 100 });
    const rejection = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(5000);
    await rejection;
    expect(FakeWorker.instances[0]?.terminate).toHaveBeenCalledOnce();
    await expect(hardware.getCall("225", "getCpuTemp")).rejects.toThrow(
      "restart ALFC",
    );
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it("performs native cleanup on its worker before terminating it", async () => {
    const hardware = await import("./hardware");
    const init = hardware.wmiInit();
    const worker = FakeWorker.instances[0]!;
    worker.respond({ id: 1, ok: true });
    await init;
    const cleanup = hardware.wmiCleanup();
    expect(worker.requests[1]?.operation).toEqual({ kind: "cleanupWmi" });
    expect(worker.terminate).not.toHaveBeenCalled();
    await expect(hardware.getCall("225", "getCpuTemp")).rejects.toThrow(
      "closing",
    );
    worker.respond({ id: 2, ok: true });
    await cleanup;
    await hardware.wmiCleanup();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("isolates a stalled optional CPU worker and retains Native AOT through cleanup", async () => {
    const hardware = await import("./hardware");
    const failed = vi.fn();
    hardware.onHardwareFailure(failed);
    const tune = hardware.tuneInit();
    const rejection = expect(tune).rejects.toMatchObject({
      restartRequired: true,
      channel: "cpuoc",
    });
    const cpuWorker = FakeWorker.instances[0]!;
    const get = hardware.getCall("225", "getCpuTemp");
    const wmiWorker = FakeWorker.instances[1]!;
    wmiWorker.respond({ id: 1, ok: true, result: 42 });
    await expect(get).resolves.toBe(42);
    await vi.advanceTimersByTimeAsync(5000);
    await rejection;
    expect(failed.mock.calls[0]?.[0]).toBe("cpuoc");
    expect(cpuWorker.terminate).not.toHaveBeenCalled();
    const set = hardware.setCall("107", "SetFixedFanSpeed", { Data: 100 });
    wmiWorker.respond({ id: 2, ok: true });
    await set;
    await hardware.cpuocCleanup();
    expect(cpuWorker.unref).toHaveBeenCalled();
    expect(cpuWorker.terminate).not.toHaveBeenCalled();
    await expect(hardware.tune(37, 106)).rejects.toThrow();
  });

  it("propagates a native WMI deadline as a fatal channel failure before the JS watchdog", async () => {
    const hardware = await import("./hardware");
    const failed = vi.fn();
    hardware.onHardwareFailure(failed);
    const get = hardware.getCall("225", "getCpuTemp");
    const worker = FakeWorker.instances[0]!;
    worker.respond({
      id: 1,
      ok: false,
      error: "WMI provider timed out",
      restartRequired: true,
    });
    await expect(get).rejects.toMatchObject({
      restartRequired: true,
      channel: "wmi",
    });
    expect(failed.mock.calls[0]?.[0]).toBe("wmi");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
