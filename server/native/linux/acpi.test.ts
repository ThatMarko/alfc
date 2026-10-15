describe("linux ACPI adapter", () => {
  let acpiExists = true;
  let acpiReadText = "0x2a\0\n";
  let writtenCommands: string[] = [];

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    acpiExists = true;
    acpiReadText = "0x2a\0\n";
    writtenCommands = [];

    const originalBun = global.Bun;
    global.Bun = {
      ...originalBun,
      file: vi.fn(() => ({
        exists: () => Promise.resolve(acpiExists),
        text: () => Promise.resolve(acpiReadText),
      })),
      write: vi.fn((_path: string, data: string) => {
        writtenCommands.push(data);
        return Promise.resolve(data.length);
      }),
    } as unknown as typeof Bun;
  });

  it("formats getCall and setCall commands with reversed little-endian argument bytes", async () => {
    const acpi = await import("./acpi");

    const temp = await acpi.getCall("0xe1", "getCpuTemp");
    expect(temp).toBe(42);
    expect(writtenCommands[0]).toBe("\\_SB.PCI0.AMW0.WMBC 0 0xe1 0");

    await acpi.setCall("0x59", "SetLightBar", {
      Index: 1,
      Status: 2,
      Level: 3,
      Red: 4,
      Green: 5,
      Blue: 6,
    });
    expect(writtenCommands[1]).toBe(
      "\\_SB.PCI0.AMW0.WMBD 0 0x59 0x060504030201",
    );
  });

  it("uses declared argument order even when a client reorders JSON properties", async () => {
    const acpi = await import("./acpi");
    await acpi.setCall("104", "SetFanIndexValue", {
      Value: 3,
      Index: 1,
      Temperture: 2,
    });
    expect(writtenCommands).toEqual(["\\_SB.PCI0.AMW0.WMBD 0 104 0x030201"]);
  });

  it("rejects firmware errors returned after a successful write", async () => {
    const acpi = await import("./acpi");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    acpiReadText = "Error: AE_NOT_FOUND\0";
    await expect(
      acpi.setCall("107", "SetFixedFanSpeed", { Data: 100 }),
    ).rejects.toThrow("AE_NOT_FOUND");
    errorSpy.mockRestore();
  });

  it("strictly parses ACPI integer/buffer results without precision loss", async () => {
    const acpi = await import("./acpi");
    acpiReadText = "{0x01, 0x02, 0x03}";
    await expect(acpi.getCall("86", "GetThermalData")).resolves.toBe(0x030201);
    acpiReadText =
      "{0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff}";
    await expect(acpi.getCall("96", "GetDeepFan")).resolves.toBe(
      "1208925819614629174706175",
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    acpiReadText = "0x2a trailing garbage";
    await expect(acpi.getCall("225", "getCpuTemp")).resolves.toBeNaN();
    errorSpy.mockRestore();
  });

  it("treats an empty argument map as 0 instead of an invalid 0x prefix", async () => {
    const acpi = await import("./acpi");

    await acpi.getCall("70", "GetCPUFanDuty", {});
    expect(writtenCommands[0]).toBe("\\_SB.PCI0.AMW0.WMBC 0 70 0");
  });

  it.each([
    ["225", "getCpuTemp", "{0x2a}"],
    ["225", "getCpuTemp", "0x10000"],
    ["70", "GetCPUFanDuty", "0x100"],
    ["86", "GetThermalData", "{0x01, 0x02}"],
  ])(
    "rejects output that does not fit the declared %s/%s signature",
    async (methodId, methodName, response) => {
      const acpi = await import("./acpi");
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      acpiReadText = response;
      await expect(acpi.getCall(methodId, methodName)).resolves.toBeNaN();
      log.mockRestore();
    },
  );

  it("rejects out-of-range argument values and malformed methodId strings", async () => {
    const acpi = await import("./acpi");

    await expect(
      acpi.setCall("0x6b", "SetFixedFanSpeed", { Data: 256 }),
    ).rejects.toThrow(RangeError);
    await expect(
      acpi.setCall("0x6b;reboot", "SetFixedFanSpeed", { Data: 100 }),
    ).rejects.toThrow(RangeError);
  });

  it("returns NaN on getCall and throws on setCall when /proc/acpi/call is absent", async () => {
    acpiExists = false;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const acpi = await import("./acpi");

    await expect(acpi.getCall("0xe1", "getCpuTemp")).resolves.toBeNaN();
    await expect(
      acpi.setCall("0x6b", "SetFixedFanSpeed", { Data: 100 }),
    ).rejects.toThrow("/proc/acpi/call is not available");
    warnSpy.mockRestore();
  });
});
