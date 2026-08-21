import { getCall, setCall } from "../native/index";
import { state } from "../state/index";
import {
  fanControl,
  fanPercentToSpeed,
  cleanupFanControlIntervals,
  CYCLE_DURATION,
  WAIT_RAMP_UP_CYCLES,
  WAIT_RAMP_DOWN_CYCLES,
} from "./index";

vi.mock("../native/index", () => ({
  getCall: vi.fn(),
  setCall: vi.fn().mockResolvedValue(undefined),
}));
const mockedGetCall = vi.mocked(getCall);
const mockedSetCall = vi.mocked(setCall);

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
    // stop auto control loop
    state.doFixedSpeed = true;
    await vi.advanceTimersByTimeAsync(CYCLE_DURATION);
    cleanupFanControlIntervals();

    vi.useRealTimers();
  });

  it("should change fan speed as temperatures change", async () => {
    fanControl();
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
            "Data": 35,
          },
        ],
        [
          "0x47",
          "SetGPUFanDuty",
          {
            "Data": 35,
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
    currentPercentage = expectedPercentage;
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

<<<<<<< HEAD
  it("does not overlap temperature collection cycles", async () => {
    mockedGetCall.mockImplementation(() => new Promise(() => undefined));

    fanControl();
    await vi.advanceTimersByTimeAsync(3 * CYCLE_DURATION);

    expect(mockedGetCall).toHaveBeenCalledTimes(1);
  });

=======
>>>>>>> origin/feat/wmi-ffi
  it("should handle fan table changes", async () => {
    fanControl();

    // Change fan tables
    state.cpuFanTable = [
      [0, 40],
      [70, 80],
      [80, 100],
    ];

    // Should reset to lowest speed in new table
    await waitUntilFanPercent(firstSpeed(state.cpuFanTable));
  });

  it("should use highest fan speed when readings are invalid", async () => {
    fanControl();

    mockedGetCall.mockResolvedValue(NaN);
    await waitUntilFanPercent(lastSpeed(state.gpuFanTable));
  });

  it("should use highest fan speed when temperature reads reject", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    fanControl();

    mockedGetCall.mockRejectedValue(new Error("WMI read failed"));
    await waitUntilFanPercent(lastSpeed(state.gpuFanTable));

    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("failed"),
      expect.any(Error),
    );
    warning.mockRestore();
  });
});
