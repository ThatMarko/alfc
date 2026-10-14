import type { Pointer } from "bun:ffi";

const pointerMemory = new Map<number, Uint8Array>();
let nextPointerAddress = 0x1000;
let lastErrorText = "Simulated WMI error";

const mockSymbols = {
  wmi_abi_version: vi.fn<() => number>(() => 2),
  wmi_init: vi.fn<() => number>(() => 0),
  wmi_get: vi.fn<
    (
      methodPtr: Pointer,
      argValue: number,
      resultsPtr: Pointer,
      countPtr: Pointer,
    ) => number
  >(() => 0),
  wmi_get_named: vi.fn<
    (
      methodPtr: Pointer,
      namesPtr: Pointer,
      namesLen: number,
      valuesPtr: Pointer,
      count: number,
      resultsPtr: Pointer,
      countPtr: Pointer,
    ) => number
  >(() => 0),
  wmi_set: vi.fn<(methodPtr: Pointer, argValue: number) => number>(() => 0),
  wmi_set_named: vi.fn<
    (
      methodPtr: Pointer,
      namesPtr: Pointer,
      namesLen: number,
      valuesPtr: Pointer,
      count: number,
    ) => number
  >(() => 0),
  wmi_cleanup: vi.fn<() => void>(),
  wmi_get_last_error: vi.fn<() => Pointer>(() => 0xdead as Pointer),
};

const mockClose = vi.fn<() => void>();
const mockDlopen = vi.fn(() => ({
  symbols: mockSymbols,
  close: mockClose,
}));

function readCStringFromPointer(address: Pointer): string {
  const view = pointerMemory.get(Number(address));
  if (!view) {
    throw new Error(`Unregistered pointer: ${String(address)}`);
  }
  const nulIndex = view.indexOf(0);
  const slice = nulIndex >= 0 ? view.subarray(0, nulIndex) : view;
  return Buffer.from(slice).toString("utf8");
}

function readNulSeparatedNames(address: Pointer, byteLength: number): string[] {
  const view = pointerMemory.get(Number(address));
  if (!view) {
    throw new Error(`Unregistered pointer: ${String(address)}`);
  }
  const raw = Buffer.from(view.subarray(0, byteLength)).toString("utf8");
  if (!raw.endsWith("\0")) {
    throw new Error("Expected trailing NUL terminator on argument name buffer");
  }
  return raw.slice(0, -1).split("\0");
}

function readUint8Values(address: Pointer, count: number): number[] {
  const view = pointerMemory.get(Number(address));
  if (!view) {
    throw new Error(`Unregistered pointer: ${String(address)}`);
  }
  return Array.from(view.subarray(0, count));
}

function writeGetResults(
  resultsPtr: Pointer,
  countPtr: Pointer,
  values: number[],
) {
  const resultsBytes = pointerMemory.get(Number(resultsPtr));
  const countBytes = pointerMemory.get(Number(countPtr));
  if (!resultsBytes || !countBytes) {
    throw new Error("Output buffers were not registered with ptr()");
  }
  const resultsView = new Float64Array(
    resultsBytes.buffer,
    resultsBytes.byteOffset,
    resultsBytes.byteLength / Float64Array.BYTES_PER_ELEMENT,
  );
  const countView = new Int32Array(
    countBytes.buffer,
    countBytes.byteOffset,
    countBytes.byteLength / Int32Array.BYTES_PER_ELEMENT,
  );
  values.forEach((v, i) => {
    resultsView[i] = v;
  });
  countView[0] = values.length;
}

vi.mock("bun:ffi", () => ({
  FFIType: {
    i32: 5,
    ptr: 12,
    void: 13,
  },
  ptr: vi.fn((view: ArrayBufferView) => {
    const address = nextPointerAddress;
    nextPointerAddress += 0x100;
    pointerMemory.set(
      address,
      new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
    );
    return address as Pointer;
  }),
  dlopen: mockDlopen,
  CString: class MockCString {
    private value: string;
    constructor(address: Pointer) {
      this.value = Number(address) === 0xdead ? lastErrorText : "Unknown error";
    }
    toString() {
      return this.value;
    }
  },
}));

describe("windows WMI FFI adapter", () => {
  let dllExists = true;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    pointerMemory.clear();
    nextPointerAddress = 0x1000;
    lastErrorText = "Simulated WMI error";
    dllExists = true;

    mockSymbols.wmi_init.mockImplementation(() => 0);
    mockSymbols.wmi_abi_version.mockImplementation(() => 2);
    mockSymbols.wmi_get.mockImplementation(
      (_methodPtr, _argValue, resultsPtr, countPtr) => {
        writeGetResults(resultsPtr, countPtr, [42, 0]);
        return 0;
      },
    );
    mockSymbols.wmi_get_named.mockImplementation(
      (
        _methodPtr,
        _namesPtr,
        _namesLen,
        _valuesPtr,
        _count,
        resultsPtr,
        countPtr,
      ) => {
        writeGetResults(resultsPtr, countPtr, [1, 2, 3, 4, 5]);
        return 0;
      },
    );
    mockSymbols.wmi_set.mockImplementation(() => 0);
    mockSymbols.wmi_set_named.mockImplementation(() => 0);

    const originalBun = global.Bun;
    global.Bun = {
      ...originalBun,
      sleep: vi.fn(() => Promise.resolve()),
      file: vi.fn(() => ({
        exists: () => Promise.resolve(dllExists),
      })),
    } as unknown as typeof Bun;
  });

  it("defers dlopen until wmiInit is called", async () => {
    const acpi = await import("./acpi");
    expect(mockDlopen).not.toHaveBeenCalled();

    await expect(acpi.getCall("0xe1", "getCpuTemp")).rejects.toThrow(
      "WMI not initialized",
    );

    await acpi.wmiInit();
    expect(mockDlopen).toHaveBeenCalledTimes(1);
    expect(mockSymbols.wmi_init).toHaveBeenCalledTimes(1);
  });

  it("fails fast with a clear message when WmiDll.dll is missing", async () => {
    dllExists = false;
    const acpi = await import("./acpi");

    await expect(acpi.wmiInit()).rejects.toThrow(/WmiDll\.dll not found/);
    expect(mockDlopen).not.toHaveBeenCalled();
  });

  it("rejects an incompatible native output ABI before executing hardware calls", async () => {
    mockSymbols.wmi_abi_version.mockReturnValue(1);
    const acpi = await import("./acpi");
    await expect(acpi.wmiInit()).rejects.toThrow(/incompatible ABI/);
    expect(mockSymbols.wmi_init).not.toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalledTimes(1);
    await expect(acpi.getCall("0xe1", "getCpuTemp")).rejects.toThrow(
      /not initialized/,
    );
  });

  it("retries wmiInit up to 3 times and surfaces native error text", async () => {
    lastErrorText = "ConnectServer ROOT\\WMI failed: 0x8004100E";
    mockSymbols.wmi_init
      .mockReturnValueOnce(-1)
      .mockReturnValueOnce(-1)
      .mockReturnValueOnce(0);

    const acpi = await import("./acpi");
    await acpi.wmiInit();
    expect(mockSymbols.wmi_init).toHaveBeenCalledTimes(3);

    mockSymbols.wmi_init.mockReturnValue(-1);
    await expect(acpi.wmiInit()).rejects.toThrow(
      "WMI init failed: ConnectServer ROOT\\WMI failed: 0x8004100E",
    );
  });

  it("routes single-Data calls through wmi_set and wmi_get with pointer caching", async () => {
    const acpi = await import("./acpi");
    await acpi.wmiInit();

    await acpi.setCall("0x6b", "SetFixedFanSpeed", { Data: 180 });
    await acpi.setCall("0x6b", "SetFixedFanSpeed", { Data: 200 });

    expect(mockSymbols.wmi_set).toHaveBeenCalledTimes(2);
    const firstPtr = mockSymbols.wmi_set.mock.calls[0]?.[0];
    const secondPtr = mockSymbols.wmi_set.mock.calls[1]?.[0];
    expect(firstPtr).toBeDefined();
    expect(firstPtr).toBe(secondPtr);
    expect(readCStringFromPointer(firstPtr!)).toBe("SetFixedFanSpeed");
    expect(mockSymbols.wmi_set.mock.calls[0]?.[1]).toBe(180);
    expect(mockSymbols.wmi_set.mock.calls[1]?.[1]).toBe(200);

    const temp = await acpi.getCall("0xe1", "getCpuTemp");
    expect(temp).toBe(42);
    expect(mockSymbols.wmi_get).toHaveBeenCalledWith(
      expect.any(Number),
      -1,
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("rejects missing or out-of-range Data arguments on the single-Data path", async () => {
    const acpi = await import("./acpi");
    await acpi.wmiInit();

    await expect(acpi.setCall("0x6b", "SetFixedFanSpeed", {})).rejects.toThrow(
      TypeError,
    );
    await expect(
      acpi.setCall("0x6b", "SetFixedFanSpeed", { Data: 256 }),
    ).rejects.toThrow(RangeError);
    await expect(
      acpi.setCall("0x6b", "SetFixedFanSpeed", { Data: -1 }),
    ).rejects.toThrow(RangeError);
    await expect(
      acpi.getCall("0x59", "GetLightBar", { Index: 1.5 }),
    ).rejects.toThrow(RangeError);
  });

  it("routes non-Data and multi-argument calls through wmi_get_named and wmi_set_named", async () => {
    const acpi = await import("./acpi");
    await acpi.wmiInit();

    await acpi.setCall("0x59", "SetLightBar", {
      Index: 1,
      Status: 1,
      Level: 3,
      Red: 255,
      Green: 128,
      Blue: 0,
    });

    expect(mockSymbols.wmi_set_named).toHaveBeenCalledTimes(1);
    const [setMethodPtr, setNamesPtr, setNamesLen, setValuesPtr, setCount] =
      mockSymbols.wmi_set_named.mock.calls[0]!;
    expect(readCStringFromPointer(setMethodPtr)).toBe("SetLightBar");
    expect(readNulSeparatedNames(setNamesPtr, setNamesLen)).toEqual([
      "Index",
      "Status",
      "Level",
      "Red",
      "Green",
      "Blue",
    ]);
    expect(readUint8Values(setValuesPtr, setCount)).toEqual([
      1, 1, 3, 255, 128, 0,
    ]);

    const lightBarVal = await acpi.getCall("0x59", "GetLightBar", { Index: 2 });
    expect(lightBarVal).toBe(0x0504030201);
    expect(mockSymbols.wmi_get_named).toHaveBeenCalledTimes(1);
    const [getMethodPtr, getNamesPtr, getNamesLen, getValuesPtr, getCount] =
      mockSymbols.wmi_get_named.mock.calls[0]!;
    expect(readCStringFromPointer(getMethodPtr)).toBe("GetLightBar");
    expect(readNulSeparatedNames(getNamesPtr, getNamesLen)).toEqual(["Index"]);
    expect(readUint8Values(getValuesPtr, getCount)).toEqual([2]);
  });

  it("decodes canonical little-endian bytes without inferring uint16 width from its value", async () => {
    const acpi = await import("./acpi");
    await acpi.wmiInit();

    mockSymbols.wmi_get.mockImplementationOnce(
      (_methodPtr, _argValue, resultsPtr, countPtr) => {
        writeGetResults(resultsPtr, countPtr, [0xb8, 0x0b]);
        return 0;
      },
    );
    await expect(acpi.getCall("0xe4", "getRpm1")).resolves.toBe(3000);

    mockSymbols.wmi_get.mockImplementationOnce(
      (_methodPtr, _argValue, resultsPtr, countPtr) => {
        writeGetResults(resultsPtr, countPtr, [0x12, 0x34, 0x56]);
        return 0;
      },
    );
    await expect(acpi.getCall("0x56", "GetThermalData")).resolves.toBe(
      0x563412,
    );
  });

  it("preserves exact values for outputs wider than JavaScript safe integers", async () => {
    const acpi = await import("./acpi");
    await acpi.wmiInit();
    mockSymbols.wmi_get.mockImplementationOnce(
      (_methodPtr, _argValue, resultsPtr, countPtr) => {
        writeGetResults(resultsPtr, countPtr, Array<number>(10).fill(255));
        return 0;
      },
    );
    await expect(acpi.getCall("0x60", "GetDeepFan")).resolves.toBe(
      ((1n << 80n) - 1n).toString(),
    );
  });

  it.each([-1, 0, 1, 3, 17, 2_147_483_647])(
    "rejects invalid native result counts (%i)",
    async (count) => {
      const acpi = await import("./acpi");
      await acpi.wmiInit();
      mockSymbols.wmi_get.mockImplementationOnce(
        (_methodPtr, _argValue, resultsPtr, countPtr) => {
          writeGetResults(resultsPtr, countPtr, [42, 0]);
          const bytes = pointerMemory.get(Number(countPtr))!;
          new Int32Array(bytes.buffer, bytes.byteOffset, 1)[0] = count;
          return 0;
        },
      );
      await expect(acpi.getCall("0xe1", "getCpuTemp")).rejects.toThrow(
        /byte count/,
      );
    },
  );

  it.each([NaN, Infinity, -1, 1.5, 256])(
    "rejects invalid native byte values (%s)",
    async (invalid) => {
      const acpi = await import("./acpi");
      await acpi.wmiInit();
      mockSymbols.wmi_get.mockImplementationOnce(
        (_methodPtr, _argValue, resultsPtr, countPtr) => {
          writeGetResults(resultsPtr, countPtr, [invalid, 0]);
          return 0;
        },
      );
      await expect(acpi.getCall("0xe1", "getCpuTemp")).rejects.toThrow(
        /invalid byte/,
      );
    },
  );

  it("rejects missing output instead of using data from a previous call", async () => {
    const acpi = await import("./acpi");
    await acpi.wmiInit();
    await expect(acpi.getCall("0xe1", "getCpuTemp")).resolves.toBe(42);
    mockSymbols.wmi_get.mockImplementationOnce(() => 0);
    await expect(acpi.getCall("0xe1", "getCpuTemp")).rejects.toThrow(
      /byte count/,
    );
  });

  it("retains the full declared width when a uint16 output is below 256", async () => {
    const acpi = await import("./acpi");
    await acpi.wmiInit();
    mockSymbols.wmi_get.mockImplementationOnce(
      (_methodPtr, _argValue, resultsPtr, countPtr) => {
        writeGetResults(resultsPtr, countPtr, [42, 0]);
        return 0;
      },
    );
    await expect(acpi.getCall("0xe4", "getRpm1")).resolves.toBe(42);
    mockSymbols.wmi_get.mockImplementationOnce(
      (_methodPtr, _argValue, resultsPtr, countPtr) => {
        writeGetResults(resultsPtr, countPtr, [42]);
        return 0;
      },
    );
    await expect(acpi.getCall("0xe4", "getRpm1")).rejects.toThrow(/expected 2/);
  });

  it("validates method names and full input signatures before entering native code", async () => {
    const acpi = await import("./acpi");
    await acpi.wmiInit();
    await expect(acpi.getCall("0xe1", "getCpuTemp\0other")).rejects.toThrow(
      /Unknown WMI method/,
    );
    await expect(acpi.getCall("0xe1", "constructor")).rejects.toThrow(
      /Unknown WMI method/,
    );
    await expect(acpi.getCall("0x59", "GetLightBar")).rejects.toThrow(
      /requires a Index/,
    );
    await expect(
      acpi.setCall("0x59", "SetLightBar", { Index: 1 }),
    ).rejects.toThrow(/requires/);
    await expect(
      acpi.getCall("0xe1", "getCpuTemp", { Data: 1 }),
    ).rejects.toThrow(/no input argument/);
    expect(mockSymbols.wmi_get).not.toHaveBeenCalled();
    expect(mockSymbols.wmi_get_named).not.toHaveBeenCalled();
    expect(mockSymbols.wmi_set_named).not.toHaveBeenCalled();
  });

  it("coalesces simultaneous initialization requests", async () => {
    const acpi = await import("./acpi");
    await Promise.all([acpi.wmiInit(), acpi.wmiInit(), acpi.wmiInit()]);
    expect(mockDlopen).toHaveBeenCalledTimes(1);
    expect(mockSymbols.wmi_init).toHaveBeenCalledTimes(1);
  });

  it("permanently rejects commands and reinitialization after a native timeout", async () => {
    const acpi = await import("./acpi");
    await acpi.wmiInit();
    lastErrorText = "ExecMethod(getCpuTemp) timed out; restart ALFC";
    mockSymbols.wmi_get.mockReturnValueOnce(-2);
    await expect(acpi.getCall("0xe1", "getCpuTemp")).rejects.toThrow(
      /timed out/,
    );
    await expect(acpi.getCall("0xe1", "getCpuTemp")).rejects.toThrow(
      /restart ALFC/,
    );
    await expect(
      acpi.setCall("0x6b", "SetFixedFanSpeed", { Data: 100 }),
    ).rejects.toThrow(/restart ALFC/);
    await expect(acpi.wmiInit()).rejects.toThrow(/restart ALFC/);
    expect(mockSymbols.wmi_get).toHaveBeenCalledTimes(1);
    expect(mockSymbols.wmi_set).not.toHaveBeenCalled();
    expect(mockSymbols.wmi_init).toHaveBeenCalledTimes(1);
  });

  it("does not reopen a library cleaned up during initialization backoff", async () => {
    let resumeSleep: (() => void) | undefined;
    Bun.sleep = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resumeSleep = resolve;
        }),
    ) as typeof Bun.sleep;
    mockSymbols.wmi_init.mockReturnValueOnce(-1);
    const acpi = await import("./acpi");
    const pending = acpi.wmiInit();
    const rejection = expect(pending).rejects.toThrow(/already closed/);
    await vi.waitFor(() => expect(resumeSleep).toBeDefined());
    acpi.wmiCleanup();
    resumeSleep!();
    await rejection;
    expect(mockDlopen).toHaveBeenCalledTimes(1);
    expect(mockSymbols.wmi_init).toHaveBeenCalledTimes(1);
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it("closes the library even when native cleanup throws", async () => {
    const acpi = await import("./acpi");
    await acpi.wmiInit();
    mockSymbols.wmi_cleanup.mockImplementationOnce(() => {
      throw new Error("cleanup failed");
    });
    expect(() => acpi.wmiCleanup()).toThrow("cleanup failed");
    expect(mockClose).toHaveBeenCalledTimes(1);
    acpi.wmiCleanup();
    await expect(acpi.wmiInit()).rejects.toThrow(/already closed/);
  });

  it("releases native resources on wmiCleanup and rejects subsequent calls", async () => {
    const acpi = await import("./acpi");
    await acpi.wmiInit();

    acpi.wmiCleanup();
    acpi.wmiCleanup();

    expect(mockSymbols.wmi_cleanup).toHaveBeenCalledTimes(1);
    expect(mockClose).toHaveBeenCalledTimes(1);
    await expect(acpi.getCall("0xe1", "getCpuTemp")).rejects.toThrow(
      "WMI library is already closed",
    );
    await expect(
      acpi.setCall("0x6b", "SetFixedFanSpeed", { Data: 100 }),
    ).rejects.toThrow("WMI library is already closed");
    await expect(acpi.wmiInit()).rejects.toThrow(
      "WMI library is already closed",
    );
  });
});
