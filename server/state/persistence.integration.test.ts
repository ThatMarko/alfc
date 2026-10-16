import { execFile } from "node:child_process";
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const repository = path.resolve(import.meta.dirname, "../..");
const dependencyName = "json-stringify-pretty-compact";

// Run the unchanged production store in a disposable source layout. Importing
// only state/validation does not initialize hardware or own a network listener.
const fixture = `
import assert from 'node:assert/strict';
import { readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
const stagedPackage = path.join(import.meta.dirname, 'server/node_modules/json-stringify-pretty-compact');
const dependency = Bun.resolveSync('json-stringify-pretty-compact', path.join(import.meta.dirname, 'server/state'));
assert.equal(path.relative(await realpath(stagedPackage), await realpath(dependency)), 'index.js',
  'The production store must resolve the copied package inside the sandbox, without checkout junctions');
const config = path.join(import.meta.dirname, 'alfc.config.json');
const initial = {
  cpuFanTable: [[40,15],[88,100]], gpuFanTable: [[40,15],[83,100]],
  gpuBoost: true, pl1: 37, pl2: 106, doFixedSpeed: false, fixedPercentage: 50,
};
await writeFile(config, JSON.stringify(initial), { mode: 0o600 });
const originalUmask = process.umask(0o022);
try {
  const { state, persistState } = await import('./server/state/index.ts');
  state.fixedPercentage = 71;
  await persistState();
  assert.equal(JSON.parse(await readFile(config, 'utf8')).fixedPercentage, 71);
  if (process.platform !== 'win32') assert.equal((await stat(config)).mode & 0o777, 0o600,
    'A normal service umask must not widen an existing restricted config');

  // Missing settings and a stale permissive temp file are both supported
  // recovery states. Neither may introduce default group/other readability.
  await rm(config);
  await writeFile(config + '.tmp', 'stale snapshot', { mode: 0o644 });
  state.fixedPercentage = 72;
  await persistState();
  assert.equal(JSON.parse(await readFile(config, 'utf8')).fixedPercentage, 72);
  if (process.platform !== 'win32') assert.equal((await stat(config)).mode & 0o777, 0o600,
    'New settings must use a restrictive mode even when a stale temp file exists');
  await assert.rejects(stat(config + '.tmp'), error => error.code === 'ENOENT');
} finally {
  process.umask(originalUmask);
}
console.log('PASS actual ordered persistence preserves restricted mode and recovers missing config/stale temp');
`;

describe("real configuration persistence", () => {
  it("preserves private settings across atomic saves under a normal service umask", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "alfc-state-fs-"));
    try {
      for (const name of ["server/state", "server/utils", "common"])
        await mkdir(path.join(directory, name), { recursive: true });
      for (const name of [
        "server/state/index.ts",
        "server/utils/consts.ts",
        "common/validation.ts",
      ])
        await copyFile(path.join(repository, name), path.join(directory, name));
      // Resolve from the real workspace once, then copy the complete installed
      // package. A junction to node_modules can retain another relative link
      // layer in Bun's platform-specific install layout; the disposable tree
      // must own its dependency closure independently of that layout.
      const require = createRequire(
        path.join(repository, "server/package.json"),
      );
      const dependencyDirectory = path.dirname(require.resolve(dependencyName));
      const manifest = JSON.parse(
        await readFile(path.join(dependencyDirectory, "package.json"), "utf8"),
      ) as {
        name: string;
        dependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
      };
      expect(manifest.name).toBe(dependencyName);
      expect(
        Object.keys({
          ...manifest.dependencies,
          ...manifest.optionalDependencies,
        }),
        "Extend the fixture's copied dependency closure if this package gains runtime dependencies",
      ).toEqual([]);
      await cp(
        dependencyDirectory,
        path.join(directory, "server/node_modules", dependencyName),
        {
          recursive: true,
          dereference: true,
        },
      );
      const entrypoint = path.join(directory, "fixture.ts");
      await writeFile(entrypoint, fixture);
      const { stdout } = await execute("bun", [entrypoint], {
        env: { ...process.env, NODE_ENV: "production" },
        timeout: 10_000,
        windowsHide: true,
      });
      expect(stdout).toContain(
        "PASS actual ordered persistence preserves restricted mode",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
});
