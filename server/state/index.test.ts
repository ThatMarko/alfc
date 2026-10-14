import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { readConfigMock, renameMock, stateRuntime } = vi.hoisted(() => ({
  readConfigMock: vi.fn(),
  renameMock: vi.fn().mockResolvedValue(undefined),
  stateRuntime: { isDev: true },
}));

vi.mock("node:fs", () => ({
  readFileSync: readConfigMock,
}));

vi.mock("node:fs/promises", () => ({ rename: renameMock }));
vi.mock("../utils/consts", () => stateRuntime);

const VALID_CONFIG = {
  cpuFanTable: [
    [50, 20],
    [70, 80],
  ],
  gpuFanTable: [
    [45, 15],
    [85, 100],
  ],
  gpuBoost: false,
  pl1: 40,
  pl2: 90,
  doFixedSpeed: true,
  fixedPercentage: 55,
};

const DEFAULT_CPU_TABLE = [
  [40, 15],
  [83, 50],
  [88, 100],
];
const DEFAULT_GPU_TABLE = [
  [40, 15],
  [78, 50],
  [83, 100],
];

// loadPersistedState runs at module load, so every case imports the module
// fresh against its own mocked config file.
function importState() {
  vi.resetModules();
  return import("./index");
}

function mockConfigFile(content: string) {
  readConfigMock.mockReturnValue(content);
}

describe("state config loading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stateRuntime.isDev = true;
    renameMock.mockResolvedValue(undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads a valid config into state", async () => {
    mockConfigFile(JSON.stringify(VALID_CONFIG));

    const { state } = await importState();

    expect(state.cpuFanTable).toEqual(VALID_CONFIG.cpuFanTable);
    expect(state.gpuFanTable).toEqual(VALID_CONFIG.gpuFanTable);
    expect(state.fixedPercentage).toBe(55);
    expect(state.doFixedSpeed).toBe(true);
    expect(state.gpuBoost).toBe(false);
    expect(state.protocolVersion).toBe("1.1");
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("ignores persisted capability flags and unrelated properties", async () => {
    mockConfigFile(
      JSON.stringify({
        ...VALID_CONFIG,
        isFanControlAvailable: true,
        isCpuTuningAvailable: false,
        restartRequired: true,
        unrelated: 123,
      }),
    );
    const { state } = await importState();
    expect(state.isFanControlAvailable).toBeUndefined();
    expect(state.isCpuTuningAvailable).toBeUndefined();
    expect(state.restartRequired).toBeUndefined();
    expect(state).not.toHaveProperty("unrelated");
  });

  it("serializes distinct save snapshots and strips runtime capabilities", async () => {
    stateRuntime.isDev = false;
    mockConfigFile(JSON.stringify(VALID_CONFIG));
    const write = vi.spyOn(Bun, "write").mockResolvedValue(1);
    const { state, persistState } = await importState();
    state.isFanControlAvailable = true;
    state.restartRequired = true;
    state.fixedPercentage = 60;
    const first = persistState();
    state.fixedPercentage = 80;
    const second = persistState();
    await Promise.all([first, second]);
    expect(write).toHaveBeenCalledTimes(2);
    const firstSaved = JSON.parse(String(write.mock.calls[0]?.[1]));
    const secondSaved = JSON.parse(String(write.mock.calls[1]?.[1]));
    expect(firstSaved.fixedPercentage).toBe(60);
    expect(secondSaved.fixedPercentage).toBe(80);
    expect(firstSaved).not.toHaveProperty("isFanControlAvailable");
    expect(firstSaved).not.toHaveProperty("restartRequired");
    expect(firstSaved).not.toHaveProperty("protocolVersion");
    expect(renameMock).toHaveBeenCalledTimes(2);
  });

  it("reports save failures and allows the next queued save to recover", async () => {
    stateRuntime.isDev = false;
    mockConfigFile(JSON.stringify(VALID_CONFIG));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const write = vi
      .spyOn(Bun, "write")
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValue(1);
    const { persistState } = await importState();
    await expect(persistState()).rejects.toThrow("disk full");
    await expect(persistState()).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledTimes(2);
    expect(renameMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "non-ascending temperatures",
      {
        cpuFanTable: [
          [90, 100],
          [40, 15],
        ],
      },
    ],
    ["an empty table", { gpuFanTable: [] }],
    ["out-of-range speeds", { cpuFanTable: [[40, 150]] }],
    ["out-of-range temperatures", { gpuFanTable: [[-10, 15]] }],
    ["out-of-range fixed percentage", { fixedPercentage: 150 }],
    ["out-of-range PL1 power limit", { pl1: 250 }],
    ["negative PL2 power limit", { pl2: -5 }],
    ["non-boolean doFixedSpeed", { doFixedSpeed: "yes" }],
  ] as [string, Record<string, unknown>][])(
    "falls back to defaults for %s",
    async (_label, override) => {
      mockConfigFile(JSON.stringify({ ...VALID_CONFIG, ...override }));

      const { state } = await importState();

      expect(state.cpuFanTable).toEqual(DEFAULT_CPU_TABLE);
      expect(state.gpuFanTable).toEqual(DEFAULT_GPU_TABLE);
      expect(state.fixedPercentage).toBe(50);
      expect(state.doFixedSpeed).toBe(false);
      expect(state.gpuBoost).toBe(true);
      expect(console.warn).toHaveBeenCalledWith(
        "[State] Corrupt or invalid config detected, using defaults.",
      );
    },
  );

  it("falls back to defaults for unparseable config files", async () => {
    mockConfigFile("{not json");

    const { state } = await importState();

    expect(state.cpuFanTable).toEqual(DEFAULT_CPU_TABLE);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load config"),
    );
  });

  it("falls back to defaults when the config file is missing", async () => {
    readConfigMock.mockImplementation(() => {
      throw new Error("ENOENT: no such file");
    });

    const { state } = await importState();

    expect(state.cpuFanTable).toEqual(DEFAULT_CPU_TABLE);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load config"),
    );
  });
});
