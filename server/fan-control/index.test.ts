import { getCall, setCall } from "../native/index";
import { publishActivity } from "../websocket/index";
import { state } from "../state/index";
import {
  fanControl,
  fanPercentToSpeed,
  cleanupFanControlIntervals,
  CYCLE_DURATION,
  SENSOR_READ_TIMEOUT,
  WAIT_RAMP_UP_CYCLES,
  WAIT_RAMP_DOWN_CYCLES,
  applyFixedFan,
  restoreAutoFanControl,
} from "./index";

vi.mock("../native/index", () => ({
  getCall: vi.fn(),
  setCall: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../websocket/index", () => ({
  publishActivity: vi.fn(),
}));
const mockedGetCall = vi.mocked(getCall);
const mockedSetCall = vi.mocked(setCall);
const mockedPublishActivity = vi.mocked(publishActivity);

function firstSpeed(table: [number, number][]) {
  const entry = table[0];
  if (!entry) throw new Error("Fan table is empty");
  return entry[1];
}

function lastSpeed(table: [number, number][]) {
  const entry = table[table.length - 1];
  if (!entry) throw new Error("Fan table is empty");
  return entry[1];
}

function mockTemperatures(cpu: number, gpu: number) {
  mockedGetCall.mockImplementation((methodId: string) => {
    switch (methodId) {
      case "0xe1":
        return Promise.resolve(cpu);
      case "0xe2":
        return Promise.resolve(gpu);
      case "0xe3":
        return Promise.resolve(gpu);
      default:
        return Promise.resolve(0);
    }
  });
}

async function waitUntilFanPercent(fanPercent: number) {
  let advancedTime = 0;
  const timeout = 5 * 60_000;

  while (advancedTime <= timeout) {
    try {
      expect(mockedSetCall).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.any(String),
        {
          Data: fanPercentToSpeed(fanPercent),
        },
      );
      return advancedTime / CYCLE_DURATION;
    } catch (_) {
      void 0;
    }

    await vi.advanceTimersByTimeAsync(10);
    advancedTime += 10;
  }

  throw new Error(
    `Fan did not reach ${fanPercent}% within ${timeout / 1000} seconds`,
  );
}

describe("fan-control", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockedSetCall.mockResolvedValue(undefined);

    state.cpuFanTable = [
      [40, 15],
      [83, 50],
      [88, 50],
    ];
    state.gpuFanTable = [
      [40, 15],
      [78, 50],
      [83, 100],
    ];
    state.doFixedSpeed = false;
    mockTemperatures(30, 30);
  });

  afterEach(async () => {
    // Stop the loop first so no new cycles start, then advance past the
    // sensor-read timeout so a cycle left in flight by the test releases
    // the shared cycle lock before the next test runs. (Fixed mode is a
    // served mode now, so switching modes alone no longer stops reads.)
    cleanupFanControlIntervals();
    state.doFixedSpeed = true;
    await vi.advanceTimersByTimeAsync(SENSOR_READ_TIMEOUT);

    vi.useRealTimers();
  });

  it("should change fan speed as temperatures change", async () => {
    fanControl();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockedSetCall.mock.calls).toMatchInlineSnapshot(`
      [
        [
          "0x58",
          "SetSuperQuiet",
          {
            "Data": 0,
          },
        ],
        [
          "0x71",
          "SetAutoFanStatus",
          {
            "Data": 0,
          },
        ],
        [
          "0x67",
          "SetStepFanStatus",
          {
            "Data": 0,
          },
        ],
        [
          "0x6a",
          "SetFixedFanStatus",
          {
            "Data": 1,
          },
        ],
        [
          "0x6b",
          "SetFixedFanSpeed",
          {
            "Data": 229,
          },
        ],
        [
          "0x47",
          "SetGPUFanDuty",
          {
            "Data": 229,
          },
        ],
      ]
    `);

    // High CPU temperature => 50% fan speed
    mockTemperatures(90, 30);
    await vi.advanceTimersByTimeAsync(
      (3 * WAIT_RAMP_UP_CYCLES + 1) * CYCLE_DURATION,
    );
    expect(mockedSetCall).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(String),
      {
        Data: fanPercentToSpeed(lastSpeed(state.cpuFanTable)),
      },
    );

    // Cool CPU => 15% fan speed
    mockTemperatures(30, 30);
    await vi.advanceTimersByTimeAsync(
      (3 * WAIT_RAMP_DOWN_CYCLES + 1) * CYCLE_DURATION,
    );
    expect(mockedSetCall).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(String),
      {
        Data: fanPercentToSpeed(firstSpeed(state.cpuFanTable)),
      },
    );

    // High GPU temperature => 100% fan speed
    mockTemperatures(30, 90);
    await vi.advanceTimersByTimeAsync(
      (5 * WAIT_RAMP_UP_CYCLES + 1) * CYCLE_DURATION,
    );
    expect(mockedSetCall).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(String),
      {
        Data: fanPercentToSpeed(lastSpeed(state.gpuFanTable)),
      },
    );
  });

  it("should switch to fixed speed when doFixedSpeed becomes true", async () => {
    fanControl();

    state.doFixedSpeed = true;
    state.fixedPercentage = 75;

    await vi.advanceTimersByTimeAsync(CYCLE_DURATION);
    expect(mockedSetCall).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(String),
      {
        Data: fanPercentToSpeed(state.fixedPercentage),
      },
    );
  });

  it("fan speed adjusts gradually after temperature change", async () => {
    // We can't just repeatedly advance the timer in this test because execution times aren't perfect and when allowing for a bit of leeway, we would cut into the time for the next gradient step.

    fanControl();
    // Make sure steady state is reached at initial temperature
    await waitUntilFanPercent(firstSpeed(state.cpuFanTable));

    // Change to high CPU temperature
    mockTemperatures(90, 30);
    vi.clearAllMocks();

    const initialPercentage = firstSpeed(state.cpuFanTable);
    const targetPercentage = lastSpeed(state.cpuFanTable);

    // First gradient step
    let currentPercentage = initialPercentage;
    let expectedPercentage =
      currentPercentage +
      Math.round((targetPercentage - currentPercentage) / 2);
    let cycles = await waitUntilFanPercent(expectedPercentage);
    expect(cycles - WAIT_RAMP_UP_CYCLES).toBeLessThan(1);

    // Second gradient step
    currentPercentage = expectedPercentage;
    expectedPercentage =
      currentPercentage +
      Math.round((targetPercentage - currentPercentage) / 2);
    cycles = await waitUntilFanPercent(expectedPercentage);
    expect(cycles - WAIT_RAMP_UP_CYCLES).toBeLessThan(1);

    // Reaching target
    expectedPercentage = targetPercentage;
    cycles = await waitUntilFanPercent(expectedPercentage);
    expect(cycles - WAIT_RAMP_UP_CYCLES).toBeLessThan(1);
  });

  it("ramps to full speed promptly during a sudden thermal spike", async () => {
    fanControl();
    await waitUntilFanPercent(firstSpeed(state.cpuFanTable));

    mockTemperatures(30, 90);
    vi.clearAllMocks();

    const cycles = await waitUntilFanPercent(lastSpeed(state.gpuFanTable));
    expect(cycles).toBeLessThanOrEqual(6);
  });

  it("does not overlap temperature collection cycles", async () => {
    mockedGetCall.mockImplementation(() => new Promise(() => undefined));

    fanControl();
    await vi.advanceTimersByTimeAsync(3 * CYCLE_DURATION);

    expect(mockedGetCall).toHaveBeenCalledTimes(1);
  });

  it("escapes a stalled collection and applies fixed mode after the read timeout", async () => {
    mockedGetCall.mockImplementation(() => new Promise(() => undefined));

    fanControl();
    await vi.advanceTimersByTimeAsync(CYCLE_DURATION); // cycle starts, stalls

    state.doFixedSpeed = true;
    state.fixedPercentage = 75;

    // The loop is not torn down on the switch: the stalled read holds the
    // cycle lock until SENSOR_READ_TIMEOUT fails the collection.
    await vi.advanceTimersByTimeAsync(SENSOR_READ_TIMEOUT);

    // Recovery: the next collected cycle applies the fixed speed.
    mockTemperatures(30, 30);
    await waitUntilFanPercent(state.fixedPercentage);
  });

  it("serializes collections across restarts and aborts the stale run", async () => {
    let resolveStalledRead: ((value: number) => void) | undefined;
    mockedGetCall.mockImplementation((methodId: string) => {
      if (resolveStalledRead === undefined) {
        // First read of the first run stays pending until released
        return new Promise<number>((resolve) => {
          resolveStalledRead = resolve;
        });
      }
      switch (methodId) {
        case "0xe1":
          return Promise.resolve(90);
        default:
          return Promise.resolve(30);
      }
    });

    fanControl();
    await vi.advanceTimersByTimeAsync(CYCLE_DURATION); // first cycle stalls
    expect(mockedGetCall).toHaveBeenCalledTimes(1);

    // Restart the controller explicitly. The new run's ticks must wait:
    // collections never overlap, not even across runs.
    fanControl();
    await vi.advanceTimersByTimeAsync(CYCLE_DURATION);
    expect(mockedGetCall).toHaveBeenCalledTimes(1);

    // The old run's pending read finally settles: its collection aborts at
    // this read boundary instead of issuing its remaining reads, which
    // releases the cycle lock for the new run.
    resolveStalledRead?.(30);
    await vi.advanceTimersByTimeAsync(10);
    expect(mockedGetCall).toHaveBeenCalledTimes(1);

    // The new run replaces its safe startup maximum with the first measured
    // 50% target. Only the new run issued reads after the restart.
    await waitUntilFanPercent(50);
    expect(mockedGetCall).toHaveBeenCalledTimes(1 + 9); // 1 old, 9 new (3 samples x 3)
  });

  it("aborts a mid-sampling collection from a previous run on restart", async () => {
    mockTemperatures(90, 30);
    fanControl();
    await vi.advanceTimersByTimeAsync(CYCLE_DURATION); // first sample read
    expect(mockedGetCall).toHaveBeenCalledTimes(3); // sample 0: cpu + 2 gpu reads

    // Restart while the old cycle sleeps between samples. The old
    // collection must abort at the next read boundary: no further reads
    // from the old run before the new run's first tick.
    fanControl();
    await vi.advanceTimersByTimeAsync(CYCLE_DURATION - 10);
    expect(mockedGetCall).toHaveBeenCalledTimes(3);

    // The new run applies the first measured 50% target directly.
    await waitUntilFanPercent(50);
    expect(mockedGetCall).toHaveBeenCalledTimes(3 + 9); // 1 old sample, 1 new cycle
  });

  it("should handle fan table changes", async () => {
    fanControl();

    // Change fan tables
    state.cpuFanTable = [
      [0, 40],
      [70, 80],
      [80, 100],
    ];

    // At the current cool temperature the new curve selects its first row.
    await waitUntilFanPercent(firstSpeed(state.cpuFanTable));
  });

  it("applies a changed curve at the current temperature without a minimum-speed dip", async () => {
    mockTemperatures(90, 90);
    await fanControl();
    state.cpuFanTable = [
      [40, 10],
      [80, 90],
    ];
    state.gpuFanTable = [
      [40, 10],
      [80, 90],
    ];
    mockedSetCall.mockClear();
    await vi.advanceTimersByTimeAsync(2 * CYCLE_DURATION);
    const fanWrites = mockedSetCall.mock.calls.filter((call) =>
      ["SetFixedFanSpeed", "SetGPUFanDuty"].includes(call[1]),
    );
    expect(fanWrites.length).toBeGreaterThan(0);
    expect(
      fanWrites.every((call) => call[2].Data === fanPercentToSpeed(90)),
    ).toBe(true);
  });

  it("starts automatic control at the highest configured target before reading sensors", async () => {
    state.cpuFanTable = [
      [40, 15],
      [80, 90],
      [90, 20],
    ];
    state.gpuFanTable = [
      [40, 40],
      [80, 80],
    ];
    await fanControl();
    expect(mockedGetCall).not.toHaveBeenCalled();
    expect(mockedSetCall).toHaveBeenLastCalledWith("0x47", "SetGPUFanDuty", {
      Data: fanPercentToSpeed(90),
    });
  });

  it("never starts a hot machine at the cold curve minimum", async () => {
    mockTemperatures(95, 95);
    await fanControl();
    expect(mockedSetCall).toHaveBeenLastCalledWith("0x47", "SetGPUFanDuty", {
      Data: fanPercentToSpeed(100),
    });
    await vi.advanceTimersByTimeAsync(CYCLE_DURATION + 1000);
    const writes = mockedSetCall.mock.calls.filter((call) =>
      ["SetFixedFanSpeed", "SetGPUFanDuty"].includes(call[1]),
    );
    expect(
      writes.every((call) => call[2].Data === fanPercentToSpeed(100)),
    ).toBe(true);
    expect(mockedPublishActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({
        avgCPUTemp: 95,
        avgGPUTemp: 95,
        appliedSpeed: 100,
        target: 100,
      }),
    );
  });

  it("keeps the startup maximum through failed first reads, then applies a valid cool target", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    mockedGetCall.mockRejectedValue(
      new Error("first sensor collection unavailable"),
    );
    await fanControl();
    await vi.advanceTimersByTimeAsync(CYCLE_DURATION);
    expect(mockedGetCall).toHaveBeenCalledTimes(1);
    expect(mockedSetCall).toHaveBeenLastCalledWith("0x47", "SetGPUFanDuty", {
      Data: fanPercentToSpeed(100),
    });
    expect(mockedPublishActivity).not.toHaveBeenCalled();
    mockTemperatures(30, 30);
    await vi.advanceTimersByTimeAsync(CYCLE_DURATION + 1000);
    expect(mockedSetCall).toHaveBeenLastCalledWith("0x47", "SetGPUFanDuty", {
      Data: fanPercentToSpeed(15),
    });
    expect(mockedPublishActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({
        appliedSpeed: 15,
        target: 15,
        sensorFailure: false,
      }),
    );
    warning.mockRestore();
  });

  it("reports unknown applied speed after a partial hardware write and retries", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    await fanControl();
    await waitUntilFanPercent(15);
    mockTemperatures(90, 30);
    let failGpuWrite = true;
    mockedSetCall.mockImplementation((_id, name) => {
      if (name === "SetGPUFanDuty" && failGpuWrite) {
        failGpuWrite = false;
        return Promise.reject(new Error("GPU write failed"));
      }
      return Promise.resolve();
    });
    await vi.advanceTimersByTimeAsync(2 * CYCLE_DURATION);
    expect(mockedPublishActivity).toHaveBeenCalledWith(
      expect.objectContaining({ appliedSpeed: null }),
    );
    await vi.advanceTimersByTimeAsync(2 * CYCLE_DURATION);
    expect(mockedPublishActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({ appliedSpeed: 50, target: 50 }),
    );
    warning.mockRestore();
  });

  it("serializes each pair of direct fan writes", async () => {
    const first = applyFixedFan(60);
    const second = applyFixedFan(80);
    await Promise.all([first, second]);
    expect(mockedSetCall.mock.calls).toEqual([
      ["0x6b", "SetFixedFanSpeed", { Data: fanPercentToSpeed(60) }],
      ["0x47", "SetGPUFanDuty", { Data: fanPercentToSpeed(60) }],
      ["0x6b", "SetFixedFanSpeed", { Data: fanPercentToSpeed(80) }],
      ["0x47", "SetGPUFanDuty", { Data: fanPercentToSpeed(80) }],
    ]);
  });

  it("restores an unconfirmed fixed target even while temperature sensors fail", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    state.doFixedSpeed = true;
    state.fixedPercentage = 60;
    await fanControl();
    await vi.advanceTimersByTimeAsync(CYCLE_DURATION);
    mockedSetCall
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("transient GPU fan write failure"));
    await expect(applyFixedFan(80)).rejects.toThrow("SetGPUFanDuty failed");
    mockedSetCall.mockClear();
    mockedGetCall.mockRejectedValue(new Error("sensor unavailable"));
    await vi.advanceTimersByTimeAsync(CYCLE_DURATION);
    expect(mockedSetCall.mock.calls).toEqual([
      ["0x6b", "SetFixedFanSpeed", { Data: fanPercentToSpeed(60) }],
      ["0x47", "SetGPUFanDuty", { Data: fanPercentToSpeed(60) }],
    ]);
    expect(mockedPublishActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({
        appliedSpeed: 60,
        target: 60,
        sensorFailure: true,
      }),
    );
    warning.mockRestore();
  });

  it("restarts the cooling delay after fixed mode even when its sensors failed", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    state.doFixedSpeed = true;
    state.fixedPercentage = 80;
    await fanControl();
    state.doFixedSpeed = false;
    await vi.advanceTimersByTimeAsync(
      (WAIT_RAMP_DOWN_CYCLES - 2) * CYCLE_DURATION + 1000,
    );
    state.doFixedSpeed = true;
    mockedGetCall.mockRejectedValue(new Error("sensor unavailable"));
    await vi.advanceTimersByTimeAsync(2 * CYCLE_DURATION);
    state.doFixedSpeed = false;
    mockTemperatures(30, 30);
    mockedSetCall.mockClear();
    await vi.advanceTimersByTimeAsync(3 * CYCLE_DURATION + 1000);
    expect(mockedSetCall).not.toHaveBeenCalled();
    expect(mockedPublishActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({ appliedSpeed: 80, target: 15 }),
    );
    warning.mockRestore();
  });

  it("attempts to restore BIOS auto mode even when disabling fixed mode fails", async () => {
    mockedSetCall.mockRejectedValueOnce(new Error("fixed mode write failed"));
    await expect(restoreAutoFanControl()).rejects.toThrow(
      "Failed to restore BIOS fan control",
    );
    expect(mockedSetCall).toHaveBeenLastCalledWith("0x71", "SetAutoFanStatus", {
      Data: 1,
    });
  });

  it("should use highest fan speed when readings are invalid", async () => {
    await fanControl();
    await waitUntilFanPercent(15);
    mockedGetCall.mockResolvedValue(NaN);
    await waitUntilFanPercent(lastSpeed(state.gpuFanTable));
  });

  it("should use highest fan speed when temperature reads reject", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    await fanControl();
    await waitUntilFanPercent(15);
    mockedGetCall.mockRejectedValue(new Error("WMI read failed"));
    await waitUntilFanPercent(lastSpeed(state.gpuFanTable));

    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("failed"),
      expect.any(Error),
    );
    warning.mockRestore();
  });

  it("fails hot when only a single temperature read fails", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    let cpuReads = 0;
    await fanControl();
    await waitUntilFanPercent(15);
    mockedGetCall.mockImplementation((methodId: string) => {
      if (methodId === "0xe1") {
        cpuReads++;
        return cpuReads === 1
          ? Promise.reject(new Error("transient WMI failure"))
          : Promise.resolve(30);
      }
      return Promise.resolve(30);
    });

    // One failed read among good ones must not be diluted by averaging
    await waitUntilFanPercent(lastSpeed(state.gpuFanTable));

    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("failed"),
      expect.any(Error),
    );
    warning.mockRestore();
  });

  it("fails hot to the highest configured speed with non-monotonic tables", async () => {
    // Nothing enforces monotonic speeds: the last row is not the maximum
    state.gpuFanTable = [
      [40, 15],
      [78, 80],
      [83, 100],
      [90, 40],
    ];
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await fanControl();
    await waitUntilFanPercent(15);
    mockedGetCall.mockRejectedValue(new Error("WMI read failed"));

    // Highest speed anywhere in the tables (100), not the last row (40)
    await waitUntilFanPercent(100);

    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("failed"),
      expect.any(Error),
    );
    warning.mockRestore();
  });

  it("reports last-known temperatures instead of sentinel values on failure", async () => {
    await fanControl();
    await waitUntilFanPercent(15);
    mockTemperatures(90, 30);
    // One successful collection establishes the last-known averages (90/30)
    // and applies the first gradient step from 15% toward the 50% target
    await waitUntilFanPercent(33);
    // Successful collections publish current measurements, no failure flag
    expect(mockedPublishActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({
        avgCPUTemp: 90,
        avgGPUTemp: 30,
        sensorFailure: false,
      }),
    );
    mockedPublishActivity.mockClear();

    let cpuReads = 0;
    mockedGetCall.mockImplementation((methodId: string) => {
      if (methodId === "0xe1") {
        cpuReads++;
        return cpuReads === 1
          ? Promise.reject(new Error("transient WMI failure"))
          : Promise.resolve(30);
      }
      return Promise.resolve(30);
    });

    await waitUntilFanPercent(lastSpeed(state.gpuFanTable));

    // Fans fail hot, but the published temperatures are the last real
    // measurements — not a 200 sentinel displayed as a reading
    expect(mockedPublishActivity).toHaveBeenCalledTimes(1);
    expect(mockedPublishActivity).toHaveBeenLastCalledWith({
      appliedSpeed: 100,
      avgCPUTemp: 90,
      avgGPUTemp: 30,
      target: 100,
      sensorFailure: true,
    });
  });

  it("does not publish fabricated temperatures before any successful collection", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    mockedGetCall.mockRejectedValue(new Error("WMI read failed"));
    fanControl();

    // Fans still fail hot...
    await waitUntilFanPercent(lastSpeed(state.gpuFanTable));
    await vi.advanceTimersByTimeAsync(2 * CYCLE_DURATION);

    // ...but no activity with fabricated temperatures is ever published
    expect(mockedPublishActivity).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("failed"),
      expect.any(Error),
    );
    warning.mockRestore();
  });

  it("handles a read that rejects after the read timeout already fired", async () => {
    // The global process is typed by Bun, whose `on` overloads don't accept
    // a pre-declared listener for this event; cast to plain emitter
    // signatures for the standard NodeJS behavior (same runtime object).
    type UnhandledRejectionEvents = {
      on(
        event: "unhandledRejection",
        listener: (reason: unknown) => void,
      ): unknown;
      off(
        event: "unhandledRejection",
        listener: (reason: unknown) => void,
      ): unknown;
    };
    const nodeProcess = process as unknown as UnhandledRejectionEvents;
    let unhandledRejections = 0;
    const onUnhandledRejection = (reason: unknown) => {
      void reason;
      unhandledRejections++;
    };
    nodeProcess.on("unhandledRejection", onUnhandledRejection);
    let rejectStalledRead: ((reason: Error) => void) | undefined;
    mockedGetCall.mockImplementation(() => {
      return new Promise<number>((_, reject) => {
        if (!rejectStalledRead) {
          rejectStalledRead = reject;
        }
      });
    });

    try {
      fanControl();

      // Startup is already fail-hot; wait for the stalled read's timeout
      // before checking that its late rejection remains handled.
      await vi.advanceTimersByTimeAsync(CYCLE_DURATION + SENSOR_READ_TIMEOUT);
      expect(mockedGetCall).toHaveBeenCalledTimes(1);

      // The underlying read rejects long after the timeout consumed it
      rejectStalledRead?.(new Error("late rejection"));
      await vi.advanceTimersByTimeAsync(10);

      // withReadTimeout keeps a rejection handler attached, so this late
      // rejection must not surface as an unhandledRejection — the server
      // entry point turns those into process.exit(1)
      expect(unhandledRejections).toBe(0);
    } finally {
      nodeProcess.off("unhandledRejection", onUnhandledRejection);
    }
  });

  it("keeps collections serialized when sensor reads are slow", async () => {
    await fanControl();
    await waitUntilFanPercent(15);
    let readsInFlight = 0;
    let maxReadsInFlight = 0;
    mockedGetCall.mockImplementation((methodId: string) => {
      readsInFlight++;
      maxReadsInFlight = Math.max(maxReadsInFlight, readsInFlight);
      return new Promise<number>((resolve) => {
        setTimeout(() => {
          readsInFlight--;
          resolve(methodId === "0xe1" ? 90 : 30);
        }, 600);
      });
    });

    // A full slow cycle takes ~6.4s (9 reads x 600ms + 2x 500ms sleeps), so
    // several 2s ticks fire mid-cycle and must be skipped. The first
    // gradient step from 15% toward the 50% target still gets applied.
    await waitUntilFanPercent(33);

    // No two sensor reads were ever in flight at the same time
    expect(maxReadsInFlight).toBe(1);
  });
});
