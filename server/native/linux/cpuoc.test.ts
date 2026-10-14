describe("linux RAPL CPUOC adapter", () => {
  let writes: Array<{ path: string; data: string }> = [];

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    writes = [];

    const originalBun = global.Bun;
    global.Bun = {
      ...originalBun,
      write: vi.fn((path: string, data: string) => {
        writes.push({ path, data });
        return Promise.resolve(data.length);
      }),
    } as unknown as typeof Bun;
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
