describe("linux RAPL CPUOC adapter", () => {
  let writes: Array<{ path: string; data: string }> = [];
  let values: Map<string, string>;
  let failSecondWrite = false;
  let kernelClamps = false;
  let rollbackClamps = false;
  let unreadablePaths: Set<string>;
  let afterWrite: (() => void) | undefined;
  const root = "/sys/devices/virtual/powercap/intel-rapl/intel-rapl:0";

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    writes = [];
    failSecondWrite = false;
    kernelClamps = false;
    rollbackClamps = false;
    unreadablePaths = new Set();
    afterWrite = undefined;
    values = new Map([
      [`${root}/enabled`, "1"],
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
        text: () =>
          unreadablePaths.has(path)
            ? Promise.reject(new Error("Permission denied"))
            : Promise.resolve(values.get(path) ?? ""),
      })),
      write: vi.fn((path: string, data: string) => {
        writes.push({ path, data });
        if (failSecondWrite && writes.length === 2)
          return Promise.reject(new Error("Permission denied"));
        values.set(
          path,
          (kernelClamps && writes.length <= 2) ||
            (rollbackClamps && writes.length >= 3)
            ? "30000000"
            : data,
        );
        afterWrite?.();
        return Promise.resolve(data.length);
      }),
    } as unknown as typeof Bun;
  });

  it("rejects a disabled package zone before initialization or writes", async () => {
    values.set(`${root}/enabled`, "0");
    const cpuoc = await import("./cpuoc");
    await expect(cpuoc.tuneInit()).rejects.toThrow(
      "power limiting is disabled",
    );
    await expect(cpuoc.tune(37, 106)).rejects.toThrow(
      "power limiting is disabled",
    );
    expect(writes).toEqual([]);
    expect(values.get(`${root}/enabled`)).toBe("0");
  });

  it.each([undefined, "", "invalid"])(
    "rejects missing or invalid enabled state %j without writes",
    async (value) => {
      if (value === undefined) values.delete(`${root}/enabled`);
      else values.set(`${root}/enabled`, value);
      const cpuoc = await import("./cpuoc");
      await expect(cpuoc.tune(37, 106)).rejects.toThrow(
        "Invalid Intel RAPL enabled state",
      );
      expect(writes).toEqual([]);
    },
  );

  it.each(["disabled", "unreadable"])(
    "rechecks a cached zone that becomes %s before writing",
    async (condition) => {
      const cpuoc = await import("./cpuoc");
      await cpuoc.tuneInit();
      if (condition === "disabled") values.set(`${root}/enabled`, "0");
      else unreadablePaths.add(`${root}/enabled`);
      await expect(cpuoc.tune(37, 106)).rejects.toThrow(
        condition === "disabled"
          ? "power limiting is disabled"
          : "Permission denied",
      );
      expect(writes).toEqual([]);
    },
  );

  it.each(["disabled", "unreadable"])(
    "rolls back and requires restart if a zone becomes %s during application",
    async (condition) => {
      const cpuoc = await import("./cpuoc");
      afterWrite = () => {
        if (writes.length !== 2) return;
        if (condition === "disabled") values.set(`${root}/enabled`, "0");
        else unreadablePaths.add(`${root}/enabled`);
      };
      await expect(cpuoc.tune(37, 106)).rejects.toMatchObject({
        restartRequired: true,
      });
      expect(writes).toHaveLength(4);
      expect(values.get(`${root}/constraint_0_power_limit_uw`)).toBe(
        "45000000",
      );
      expect(values.get(`${root}/constraint_1_power_limit_uw`)).toBe(
        "95000000",
      );
      expect(
        writes.every((write) => write.path.endsWith("_power_limit_uw")),
      ).toBe(true);
      await expect(cpuoc.tune(45, 95)).rejects.toMatchObject({
        restartRequired: true,
      });
      expect(writes).toHaveLength(4);
    },
  );

  it("confirms rollback only after the zone is readable and enabled again", async () => {
    const cpuoc = await import("./cpuoc");
    afterWrite = () => {
      if (writes.length === 2) values.set(`${root}/enabled`, "0");
      if (writes.length === 4) values.set(`${root}/enabled`, "1");
    };
    await expect(cpuoc.tune(37, 106)).rejects.toMatchObject({
      restartRequired: false,
    });
    expect(values.get(`${root}/constraint_0_power_limit_uw`)).toBe("45000000");
    expect(values.get(`${root}/constraint_1_power_limit_uw`)).toBe("95000000");
    expect(writes).toHaveLength(4);
  });

  it.each([
    "/sys/class/powercap/intel-rapl:0",
    "/sys/class/powercap/intel-rapl-mmio:0",
  ])(
    "checks the selected fallback zone enable state at %s",
    async (directory) => {
      values = new Map(
        [...values].map(([path, value]) => [
          path.replace(root, directory),
          value,
        ]),
      );
      values.set(`${directory}/enabled`, "0");
      const cpuoc = await import("./cpuoc");
      await expect(cpuoc.tune(37, 106)).rejects.toThrow(
        "power limiting is disabled",
      );
      expect(writes).toEqual([]);
    },
  );

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

  it("requires restart and prevents further writes after an unverifiable rollback", async () => {
    const cpuoc = await import("./cpuoc");
    failSecondWrite = true;
    rollbackClamps = true;
    await expect(cpuoc.tune(37, 106)).rejects.toMatchObject({
      restartRequired: true,
    });
    const writeCount = writes.length;
    await expect(cpuoc.tune(45, 95)).rejects.toMatchObject({
      restartRequired: true,
    });
    await expect(cpuoc.tuneInit()).rejects.toMatchObject({
      restartRequired: true,
    });
    expect(writes).toHaveLength(writeCount);
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
