import { execFile } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { isElevated } from "./permissions";

const mocks = vi.hoisted(() => ({
  createWellKnownSid:
    vi.fn<
      (type: number, domain: null, sid: Uint8Array, size: Uint32Array) => number
    >(),
  checkTokenMembership:
    vi.fn<(token: null, sid: Uint8Array, result: Int32Array) => number>(),
  close: vi.fn<() => void>(),
  dlopen: vi.fn(),
}));

vi.mock("bun:ffi", () => ({
  FFIType: { i32: 5, ptr: 12 },
  ptr: (buffer: ArrayBufferView) => buffer,
  dlopen: mocks.dlopen,
}));

it.runIf(process.platform === "win32")(
  "matches the real Windows effective token without querying network services",
  async () => {
    const execute = promisify(execFile);
    const moduleUrl = pathToFileURL(
      path.join(import.meta.dirname, "permissions.ts"),
    ).href;
    const controller = new AbortController();
    async function probe(label: string, command: string, args: string[]) {
      try {
        const { stdout } = await execute(command, args, {
          timeout: 20_000,
          signal: controller.signal,
          windowsHide: true,
        });
        return stdout.trim().toLowerCase();
      } catch (error) {
        throw new Error(
          `${label} effective-token probe failed: ${String(error)}`,
          {
            cause: error,
          },
        );
      }
    }
    try {
      // These independent processes inherit the same effective token. Probe
      // concurrently so their cold-start costs do not add up while compilation
      // and worker fixtures also run on a busy hosted Windows runner.
      const [expected, actual] = await Promise.all([
        probe("WindowsPrincipal", "powershell.exe", [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()); Write-Output $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
        ]),
        probe("Bun Advapi32", "bun", [
          "-e",
          `const { isElevated } = await import(${JSON.stringify(moduleUrl)}); console.log(await isElevated());`,
        ]),
      ]);
      expect(expected).toMatch(/^(?:true|false)$/);
      expect(actual).toBe(expected);
    } finally {
      // Kill the sibling probe too if startup, comparison, or either command
      // fails; an outer runner timeout must not leave an unbounded child.
      controller.abort();
    }
  },
  25_000,
);

describe("effective process privileges", () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  const originalGetuid = Object.getOwnPropertyDescriptor(process, "getuid");

  beforeEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(process, "platform", { value: "win32" });
    mocks.createWellKnownSid.mockReturnValue(1);
    mocks.checkTokenMembership.mockImplementation((_token, _sid, result) => {
      result[0] = 1;
      return 1;
    });
    mocks.dlopen.mockReturnValue({
      symbols: {
        CreateWellKnownSid: mocks.createWellKnownSid,
        CheckTokenMembership: mocks.checkTokenMembership,
      },
      close: mocks.close,
    });
  });

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, "platform", originalPlatform);
    }
    if (originalGetuid) {
      Object.defineProperty(process, "getuid", originalGetuid);
    } else {
      Reflect.deleteProperty(process, "getuid");
    }
  });

  it("checks enabled Administrators membership in the current Windows token", async () => {
    await expect(isElevated()).resolves.toBe(true);
    expect(mocks.dlopen).toHaveBeenCalledWith("Advapi32.dll", {
      CreateWellKnownSid: { args: [5, 12, 12, 12], returns: 5 },
      CheckTokenMembership: { args: [12, 12, 12], returns: 5 },
    });
    const creation = mocks.createWellKnownSid.mock.calls[0];
    expect(creation?.[0]).toBe(26);
    expect(creation?.[1]).toBe(null);
    expect(creation?.[2]).toHaveLength(68);
    expect(creation?.[3]).toEqual(new Uint32Array([68]));
    expect(mocks.checkTokenMembership).toHaveBeenCalledWith(
      null,
      creation?.[2],
      new Int32Array([1]),
    );
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("rejects nonmembers and filtered UAC tokens", async () => {
    mocks.checkTokenMembership.mockImplementation((_token, _sid, result) => {
      result[0] = 0;
      return 1;
    });
    await expect(isElevated()).resolves.toBe(false);
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("fails closed if the Administrators SID cannot be created", async () => {
    mocks.createWellKnownSid.mockReturnValue(0);
    await expect(isElevated()).resolves.toBe(false);
    expect(mocks.checkTokenMembership).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("fails closed if membership lookup fails despite a nonzero output", async () => {
    mocks.checkTokenMembership.mockImplementation((_token, _sid, result) => {
      result[0] = 1;
      return 0;
    });
    await expect(isElevated()).resolves.toBe(false);
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it.each(["createWellKnownSid", "checkTokenMembership"] as const)(
    "closes the Windows library if %s throws",
    async (operation) => {
      mocks[operation].mockImplementation(() => {
        throw new Error("Windows token API failed");
      });
      await expect(isElevated()).rejects.toThrow("Windows token API failed");
      expect(mocks.close).toHaveBeenCalledOnce();
    },
  );

  it("reports an unavailable Windows token library without loading hardware", async () => {
    mocks.dlopen.mockImplementation(() => {
      throw new Error("Advapi32 could not be loaded");
    });
    await expect(isElevated()).rejects.toThrow("Advapi32 could not be loaded");
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it.each([
    [0, true],
    [1000, false],
  ] as const)(
    "checks Linux UID %s without loading Windows FFI",
    async (uid, expected) => {
      Object.defineProperty(process, "platform", { value: "linux" });
      Object.defineProperty(process, "getuid", {
        configurable: true,
        value: () => uid,
      });
      await expect(isElevated()).resolves.toBe(expected);
      expect(mocks.dlopen).not.toHaveBeenCalled();
    },
  );

  it("fails closed when a non-Windows runtime has no UID API", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    Object.defineProperty(process, "getuid", {
      configurable: true,
      value: undefined,
    });
    await expect(isElevated()).resolves.toBe(false);
    expect(mocks.dlopen).not.toHaveBeenCalled();
  });
});
