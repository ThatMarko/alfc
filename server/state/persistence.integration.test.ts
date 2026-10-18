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
import { chmod, link, lstat, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
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

  // Read-only staging files are another legitimate failed-save residue. An
  // open-before-chmod repair cannot reach its chmod on a non-root POSIX host
  // or when Windows rejects opening a file with its read-only attribute.
  await writeFile(config + '.tmp', 'readonly stale snapshot', { mode: 0o600 });
  await chmod(config + '.tmp', 0o400);
  state.fixedPercentage = 73;
  await persistState();
  assert.equal(JSON.parse(await readFile(config, 'utf8')).fixedPercentage, 73);
  if (process.platform !== 'win32') assert.equal((await stat(config)).mode & 0o777, 0o600);
  await assert.rejects(stat(config + '.tmp'), error => error.code === 'ENOENT');

  // A staging pathname can also be occupied by an unrelated non-file. Refuse
  // it before chmod/open, preserving both the entry and the durable settings.
  const staging = config + '.tmp';
  await mkdir(staging, { mode: 0o750 });
  await writeFile(path.join(staging, 'keep.txt'), 'unrelated staging-directory contents');
  const originalDirectoryMode = (await stat(staging)).mode & 0o777;
  try {
    state.fixedPercentage = 74;
    await assert.rejects(persistState());
    assert.equal((await lstat(staging)).isDirectory(), true);
    if (process.platform !== 'win32') assert.equal((await stat(staging)).mode & 0o777, originalDirectoryMode,
      'Refusing a directory must not change its permissions');
    assert.equal(await readFile(path.join(staging, 'keep.txt'), 'utf8'), 'unrelated staging-directory contents');
    assert.equal(JSON.parse(await readFile(config, 'utf8')).fixedPercentage, 73);
  } finally {
    await chmod(staging, originalDirectoryMode);
    await rm(staging, { recursive: true, force: true });
  }

  const foreignDirectory = path.join(import.meta.dirname, 'foreign-staging-target');
  await mkdir(foreignDirectory, { mode: 0o750 });
  const foreignDirectoryMode = (await stat(foreignDirectory)).mode;
  const foreignFile = path.join(foreignDirectory, 'keep.txt');
  await writeFile(foreignFile, 'unrelated contents', { mode: 0o640 });
  const foreignMode = (await stat(foreignFile)).mode & 0o777;
  // Windows junctions need no file-symlink privilege and still exercise the
  // nonregular lstat boundary. POSIX also verifies a symlink to a real file.
  await symlink(process.platform === 'win32' ? foreignDirectory : foreignFile,
    staging, process.platform === 'win32' ? 'junction' : 'file');
  state.fixedPercentage = 75;
  await assert.rejects(persistState());
  assert.equal((await lstat(staging)).isSymbolicLink(), true);
  assert.equal((await stat(foreignDirectory)).mode, foreignDirectoryMode);
  assert.equal(await readFile(foreignFile, 'utf8'), 'unrelated contents');
  if (process.platform !== 'win32') assert.equal((await stat(foreignFile)).mode & 0o777, foreignMode,
    'Refusing a symlink must not chmod its target');
  assert.equal(JSON.parse(await readFile(config, 'utf8')).fixedPercentage, 73);
  await rm(staging);

  // A hard link is a regular file, but truncating it also changes its other
  // pathname before atomic replacement. Refuse both links to the current
  // config and unrelated files, preserving bytes and permissions at each name.
  for (const target of [config, foreignFile]) {
    const originalContents = await readFile(target, 'utf8');
    const originalMode = (await stat(target)).mode;
    await link(target, staging);
    assert.equal((await lstat(staging)).nlink, 2);
    state.fixedPercentage = 76;
    await assert.rejects(persistState(), /hard link/);
    assert.equal(await readFile(target, 'utf8'), originalContents);
    assert.equal((await stat(target)).mode, originalMode,
      'Refusing a hard link must not chmod its other pathname');
    assert.equal(await readFile(staging, 'utf8'), originalContents);
    assert.equal(JSON.parse(await readFile(config, 'utf8')).fixedPercentage, 73);
    await rm(staging);
  }
  state.fixedPercentage = 73;
  await persistState();
  assert.equal(JSON.parse(await readFile(config, 'utf8')).fixedPercentage, 73);

  if (process.platform === 'win32') {
    // A failed replacement of a readonly Windows configuration leaves a
    // readonly staged file. Repairing just the main config must be enough
    // for a later save; the user must not also find and repair the temp.
    await chmod(config, 0o400);
    state.fixedPercentage = 74;
    await assert.rejects(persistState());
    assert.equal(JSON.parse(await readFile(config, 'utf8')).fixedPercentage, 73);
    assert.equal((await stat(config + '.tmp')).mode & 0o200, 0);
    await chmod(config, 0o600);
    state.fixedPercentage = 75;
    await persistState();
    assert.equal(JSON.parse(await readFile(config, 'utf8')).fixedPercentage, 75);
    await assert.rejects(stat(config + '.tmp'), error => error.code === 'ENOENT');
    console.log('PASS Windows readonly config failure and subsequent save recovery');
  }
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
      if (process.platform === "win32")
        expect(stdout).toContain(
          "PASS Windows readonly config failure and subsequent save recovery",
        );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
});
