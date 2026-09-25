import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { readConfigMock } = vi.hoisted(() => ({
  readConfigMock: vi.fn(),
}));

vi.mock("node:fs", () => ({
  readFileSync: readConfigMock,
}));

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
