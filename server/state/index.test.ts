import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";

const {
  readConfigMock,
  renameMock,
  chmodMock,
  lstatMock,
  statMock,
  openMock,
  fileMock,
  stateRuntime,
} = vi.hoisted(() => {
  const fileMock = { chmod: vi.fn(), writeFile: vi.fn(), close: vi.fn() };
  return {
    readConfigMock: vi.fn(),
    renameMock: vi.fn().mockResolvedValue(undefined),
    chmodMock: vi.fn(),
    lstatMock: vi.fn(),
    statMock: vi.fn(),
    openMock: vi.fn(),
    fileMock,
    stateRuntime: { isDev: true, isCompiledBinary: false },
  };
});

vi.mock("node:fs", () => ({
  readFileSync: readConfigMock,
}));

vi.mock("node:fs/promises", () => ({
  rename: renameMock,
  chmod: chmodMock,
  lstat: lstatMock,
  stat: statMock,
  open: openMock,
}));
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
    stateRuntime.isCompiledBinary = false;
    renameMock.mockResolvedValue(undefined);
    chmodMock.mockResolvedValue(undefined);
    lstatMock.mockResolvedValue({ isFile: () => true });
    statMock.mockResolvedValue({ mode: 0o100600 });
    openMock.mockResolvedValue(fileMock);
    fileMock.chmod.mockResolvedValue(undefined);
    fileMock.writeFile.mockResolvedValue(undefined);
    fileMock.close.mockResolvedValue(undefined);
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
    const write = fileMock.writeFile;
    const { state, persistState } = await importState();
    state.isFanControlAvailable = true;
    state.restartRequired = true;
    state.fixedPercentage = 60;
    const first = persistState();
    state.fixedPercentage = 80;
    const second = persistState();
    await Promise.all([first, second]);
    expect(write).toHaveBeenCalledTimes(2);
    const firstSaved = JSON.parse(String(write.mock.calls[0]?.[0]));
    const secondSaved = JSON.parse(String(write.mock.calls[1]?.[0]));
    expect(firstSaved.fixedPercentage).toBe(60);
    expect(secondSaved.fixedPercentage).toBe(80);
    expect(firstSaved).not.toHaveProperty("isFanControlAvailable");
    expect(firstSaved).not.toHaveProperty("restartRequired");
    expect(firstSaved).not.toHaveProperty("protocolVersion");
    expect(renameMock).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])(
    "loads and saves production config at the expected path (compiled=%s)",
    async (compiled) => {
      stateRuntime.isDev = false;
      stateRuntime.isCompiledBinary = compiled;
      mockConfigFile(JSON.stringify(VALID_CONFIG));
      const write = fileMock.writeFile;
      const configPath = compiled
        ? path.join(path.dirname(process.execPath), "alfc.config.json")
        : path.resolve(import.meta.dirname, "../../alfc.config.json");
      const { persistState } = await importState();
      expect(readConfigMock).toHaveBeenCalledWith(configPath, {
        encoding: "utf8",
      });
      await persistState();
      expect(openMock).toHaveBeenCalledWith(configPath + ".tmp", "w", 0o600);
      expect(chmodMock).toHaveBeenCalledWith(configPath + ".tmp", 0o600);
      expect(write).toHaveBeenCalledWith(expect.any(String));
      expect(fileMock.chmod).toHaveBeenCalledWith(0o600);
      expect(fileMock.close).toHaveBeenCalledOnce();
      expect(renameMock).toHaveBeenCalledWith(configPath + ".tmp", configPath);
    },
  );

  it("reports save failures and allows the next queued save to recover", async () => {
    stateRuntime.isDev = false;
    mockConfigFile(JSON.stringify(VALID_CONFIG));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const write = fileMock.writeFile
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValue(1);
    const { persistState } = await importState();
    await expect(persistState()).rejects.toThrow("disk full");
    await expect(persistState()).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledTimes(2);
    expect(renameMock).toHaveBeenCalledTimes(1);
    expect(fileMock.close).toHaveBeenCalledTimes(2);
  });

  it("leaves settings untouched when their mode cannot be read and recovers on the next save", async () => {
    stateRuntime.isDev = false;
    mockConfigFile(JSON.stringify(VALID_CONFIG));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    statMock.mockRejectedValueOnce(
      Object.assign(new Error("access denied"), { code: "EACCES" }),
    );
    const { persistState } = await importState();
    await expect(persistState()).rejects.toThrow("access denied");
    expect(chmodMock).not.toHaveBeenCalled();
    expect(openMock).not.toHaveBeenCalled();
    expect(renameMock).not.toHaveBeenCalled();
    await persistState();
    expect(renameMock).toHaveBeenCalledOnce();
  });

  it("creates a missing staging file after an ENOENT permission preflight", async () => {
    stateRuntime.isDev = false;
    mockConfigFile(JSON.stringify(VALID_CONFIG));
    lstatMock.mockRejectedValueOnce(
      Object.assign(new Error("missing staging file"), { code: "ENOENT" }),
    );
    const { persistState } = await importState();
    await expect(persistState()).resolves.toBeUndefined();
    expect(chmodMock).not.toHaveBeenCalled();
    expect(openMock).toHaveBeenCalledOnce();
    expect(fileMock.writeFile).toHaveBeenCalledOnce();
    expect(renameMock).toHaveBeenCalledOnce();
  });

  it("refuses a nonregular staging path before changing permissions or opening it", async () => {
    stateRuntime.isDev = false;
    mockConfigFile(JSON.stringify(VALID_CONFIG));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    lstatMock.mockResolvedValueOnce({ isFile: () => false });
    const { persistState } = await importState();
    await expect(persistState()).rejects.toThrow("must be a regular file");
    expect(chmodMock).not.toHaveBeenCalled();
    expect(openMock).not.toHaveBeenCalled();
    expect(fileMock.writeFile).not.toHaveBeenCalled();
    expect(renameMock).not.toHaveBeenCalled();
  });

  it("does not truncate a staging file after a permission preflight failure and lets the next save recover", async () => {
    stateRuntime.isDev = false;
    mockConfigFile(JSON.stringify(VALID_CONFIG));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    chmodMock.mockRejectedValueOnce(
      Object.assign(new Error("cannot repair staging permissions"), {
        code: "EPERM",
      }),
    );
    const { persistState } = await importState();
    await expect(persistState()).rejects.toThrow(
      "cannot repair staging permissions",
    );
    expect(openMock).not.toHaveBeenCalled();
    expect(fileMock.writeFile).not.toHaveBeenCalled();
    expect(renameMock).not.toHaveBeenCalled();
    await expect(persistState()).resolves.toBeUndefined();
    expect(renameMock).toHaveBeenCalledOnce();
  });

  it("closes the staged file without writing or replacing settings after a chmod failure", async () => {
    stateRuntime.isDev = false;
    mockConfigFile(JSON.stringify(VALID_CONFIG));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    fileMock.chmod.mockRejectedValueOnce(new Error("chmod failed"));
    const { persistState } = await importState();
    await expect(persistState()).rejects.toThrow("chmod failed");
    expect(fileMock.close).toHaveBeenCalledOnce();
    expect(fileMock.writeFile).not.toHaveBeenCalled();
    expect(renameMock).not.toHaveBeenCalled();
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
