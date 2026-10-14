import type { Pointer } from "bun:ffi";

let lastErrorText = "XTU initialization error";

const mockSymbols = {
  cpuoc_init: vi.fn<() => number>(() => 0),
  cpuoc_tune: vi.fn<(pl1: number, pl2: number) => number>(() => 0),
  cpuoc_get_last_error: vi.fn<() => Pointer>(() => 0xbeef as Pointer),
  cpuoc_free_string: vi.fn<(ptr: Pointer) => void>(),
};

const mockClose = vi.fn<() => void>();
const mockDlopen = vi.fn(() => ({
  symbols: mockSymbols,
  close: mockClose,
}));

vi.mock("bun:ffi", () => ({
  FFIType: {
    f64: 9,
    i32: 5,
    ptr: 12,
    void: 13,
  },
  dlopen: mockDlopen,
  CString: class MockCString {
    private value: string;
    constructor(address: Pointer) {
      this.value = Number(address) === 0xbeef ? lastErrorText : "Unknown error";
    }
    toString() {
      return this.value;
    }
  },
}));

describe("windows CPUOC FFI adapter", () => {
  let dllExists = true;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    dllExists = true;
    lastErrorText = "XTU initialization error";

    mockSymbols.cpuoc_init.mockImplementation(() => 0);
    mockSymbols.cpuoc_tune.mockImplementation(() => 0);

    const originalBun = global.Bun;
    global.Bun = {
      ...originalBun,
      file: vi.fn(() => ({
        exists: () => Promise.resolve(dllExists),
      })),
    } as unknown as typeof Bun;
  });

  it("defers dlopen until tuneInit and rejects tune when CPUOC.dll is absent", async () => {
    dllExists = false;
    const cpuoc = await import("./cpuoc");

    expect(mockDlopen).not.toHaveBeenCalled();
    await expect(cpuoc.tuneInit()).rejects.toThrow("CPUOC.dll not found");
    expect(mockDlopen).not.toHaveBeenCalled();
    await expect(cpuoc.tune(37, 106)).rejects.toThrow("CPUOC is not available");
  });

  it("initializes CPUOC, applies PL1/PL2 limits, and frees native error strings", async () => {
    const cpuoc = await import("./cpuoc");

    await cpuoc.tuneInit();
    expect(mockDlopen).toHaveBeenCalledTimes(1);
    expect(mockSymbols.cpuoc_init).toHaveBeenCalledTimes(1);

    await cpuoc.tune(45, 95);
    expect(mockSymbols.cpuoc_tune).toHaveBeenCalledWith(45, 95);

    mockSymbols.cpuoc_tune.mockReturnValueOnce(-1);
    await expect(cpuoc.tune(45, 95)).rejects.toThrow(
      "CPUOC tune failed: XTU initialization error",
    );
    expect(mockSymbols.cpuoc_free_string).toHaveBeenCalledWith(0xbeef);
  });

  it("retains the Native AOT library on cleanup and rejects subsequent calls", async () => {
    const cpuoc = await import("./cpuoc");
    await cpuoc.tuneInit();

    cpuoc.cpuocCleanup();
    cpuoc.cpuocCleanup();
    expect(mockClose).not.toHaveBeenCalled();

    await expect(cpuoc.tune(37, 106)).rejects.toThrow(
      "CPUOC library is already closed",
    );
    await expect(cpuoc.tuneInit()).rejects.toThrow(
      "CPUOC library is already closed",
    );
  });

  it("rejects tuning after failed initialization and validates limits before FFI", async () => {
    const cpuoc = await import("./cpuoc");
    mockSymbols.cpuoc_init.mockReturnValueOnce(-1);
    await expect(cpuoc.tuneInit()).rejects.toThrow("CPUOC init failed");
    await expect(cpuoc.tune(37, 106)).rejects.toThrow("CPUOC is not available");
    await cpuoc.tuneInit();
    for (const value of [NaN, Infinity, -1, 201, 37.5]) {
      await expect(cpuoc.tune(value, 106)).rejects.toThrow(RangeError);
    }
    expect(mockSymbols.cpuoc_tune).not.toHaveBeenCalled();
  });
});
