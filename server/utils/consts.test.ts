import path from "node:path";

describe("runtime paths and development behavior", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it.each(["development", "production"])(
    "keeps source asset paths when NODE_ENV is %s",
    async (mode) => {
      vi.resetModules();
      vi.stubGlobal("Bun", {
        ...Bun,
        env: { NODE_ENV: mode },
        isStandaloneExecutable: false,
      });
      const runtime = await import("./consts");
      expect(runtime.isCompiledBinary).toBe(false);
      expect(runtime.isDev).toBe(mode !== "production");
      expect(runtime.frontendDir).toBe(
        path.resolve(import.meta.dirname, "../../frontend/build"),
      );
    },
  );

  it.each(["development", "production"])(
    "uses executable-adjacent assets for a compiled binary with NODE_ENV %s",
    async (mode) => {
      vi.resetModules();
      vi.stubGlobal("Bun", {
        ...Bun,
        env: { NODE_ENV: mode },
        isStandaloneExecutable: true,
      });
      const runtime = await import("./consts");
      expect(runtime.isCompiledBinary).toBe(true);
      expect(runtime.isDev).toBe(false);
      expect(runtime.frontendDir).toBe(
        path.join(path.dirname(process.execPath), "frontend"),
      );
    },
  );
});
