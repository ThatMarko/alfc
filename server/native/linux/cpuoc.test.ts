describe("linux RAPL CPUOC adapter", () => {
  let writes: Array<{ path: string; data: string }> = [];
  let values: Map<string, string>;
  let failSecondWrite = false;
  let kernelClamps = false;
  const root = "/sys/devices/virtual/powercap/intel-rapl/intel-rapl:0";

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    writes = [];
    failSecondWrite = false;
    kernelClamps = false;
    values = new Map([
      [`${root}/constraint_0_power_limit_uw`, "45000000"],
      [`${root}/constraint_1_power_limit_uw`, "95000000"],
      [`${root}/constraint_0_name`, "long_term"],
      [`${root}/constraint_1_name`, "short_term"],
    ]);

    const originalBun = global.Bun;
    global.Bun = {
      ...originalBun,
      file: vi.fn((path: string) => ({
        exists: () => Promise.resolve(values.has(path)),
        text: () => Promise.resolve(values.get(path) ?? ""),
      })),
      write: vi.fn((path: string, data: string) => {
        writes.push({ path, data });
        if (failSecondWrite && writes.length === 2)
          return Promise.reject(new Error("Permission denied"));
        values.set(
          path,
          kernelClamps && writes.length <= 2 ? "30000000" : data,
        );
        return Promise.resolve(data.length);
      }),
    } as unknown as typeof Bun;
  });

  it("restores both previous limits when PL2 fails after PL1 succeeded", async () => {
    const cpuoc = await import("./cpuoc");
    failSecondWrite = true;
    await expect(cpuoc.tune(37, 106)).rejects.toThrow(
      "previous power limits restored",
    );
    expect(values.get(`${root}/constraint_0_power_limit_uw`)).toBe("45000000");
    expect(values.get(`${root}/constraint_1_power_limit_uw`)).toBe("95000000");
  });

  it("rejects silent kernel clamping and restores the hardware values", async () => {
    const cpuoc = await import("./cpuoc");
    kernelClamps = true;
    await expect(cpuoc.tune(37, 106)).rejects.toThrow(
      "previous power limits restored",
    );
    expect(values.get(`${root}/constraint_0_power_limit_uw`)).toBe("45000000");
  });

  it("resolves PL1 and PL2 by constraint name when driver indices are reversed", async () => {
    values.set(`${root}/constraint_0_name`, "short_term");
    values.set(`${root}/constraint_1_name`, "long_term");
    const cpuoc = await import("./cpuoc");
    await cpuoc.tune(37, 106);
    expect(writes[0]).toEqual({
      path: `${root}/constraint_1_power_limit_uw`,
      data: "37000000",
    });
    expect(writes[1]).toEqual({
      path: `${root}/constraint_0_power_limit_uw`,
      data: "106000000",
    });
  });

  it("rejects unsupported hardware and invalid watt limits without writes", async () => {
    const cpuoc = await import("./cpuoc");
    await expect(cpuoc.tune(NaN, 106)).rejects.toThrow(RangeError);
    values.clear();
    await expect(cpuoc.tuneInit()).rejects.toThrow("unavailable");
    expect(writes).toEqual([]);
  });

  it("converts PL1 and PL2 watt limits to microwatts and writes both RAPL constraints", async () => {
    const cpuoc = await import("./cpuoc");

    await cpuoc.tuneInit();
    await cpuoc.tune(37, 106);

    expect(writes).toEqual([
      {
        path: "/sys/devices/virtual/powercap/intel-rapl/intel-rapl:0/constraint_0_power_limit_uw",
        data: "37000000",
      },
      {
        path: "/sys/devices/virtual/powercap/intel-rapl/intel-rapl:0/constraint_1_power_limit_uw",
        data: "106000000",
      },
    ]);

    expect(() => cpuoc.cpuocCleanup()).not.toThrow();
  });
});
