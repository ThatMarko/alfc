import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

// Use the real build options, worker bridge and worker in a disposable tree.
// Only the DLL adapters are replaced; no privileged hardware code is loaded.
const fixture = `
import assert from 'node:assert/strict';
import path from 'node:path';
import { frontendDir, isCompiledBinary, isDev } from './utils/consts';
import * as hardware from './native/windows/hardware';

const compiled = !process.argv.includes('--source');
assert.equal(isCompiledBinary, compiled);
assert.equal(isDev, false);
assert.equal(frontendDir, compiled
  ? path.join(path.dirname(process.execPath), 'frontend')
  : path.resolve(import.meta.dirname, '../frontend/build'));
assert.equal(Bun.env.ALFC_BUILD_FIXTURE_DOTENV, undefined);
assert.equal(globalThis.__alfcBuildFixturePreload, undefined);

await hardware.wmiInit();
await hardware.tuneInit();
const [first, second] = await Promise.all([
  hardware.getCall('225', 'getCpuTemp'),
  hardware.getCall('96', 'GetDeepFan'),
]);
assert.equal(first, 42);
assert.equal(second, '1208925819614629174706175');
await hardware.setCall('107', 'SetFixedFanSpeed', { Data: 100 });
await hardware.tune(37, 106);
await hardware.wmiCleanup();
await hardware.cpuocCleanup();
console.log('PASS runtime paths and independent hardware workers');
`;

const acpiFixture = `
if (Bun.env.ALFC_BUILD_FIXTURE_DOTENV || globalThis.__alfcBuildFixturePreload) {
  throw new Error('Hardware worker loaded ambient configuration');
}
export let initialized = false;
export function wmiInit() { initialized = true; }
export function getCall(_id, name) {
  if (!initialized) throw new Error('WMI worker was not initialized');
  return name === 'GetDeepFan' ? '1208925819614629174706175' : 42;
}
export function setCall() {
  if (!initialized) throw new Error('WMI worker was not initialized');
}
export function wmiCleanup() { initialized = false; }
`;

const cpuFixture = `
import { initialized as wmiInitialized } from './acpi';
let initialized = false;
export function tuneInit() {
  if (wmiInitialized) throw new Error('CPU tuning shared the WMI worker');
  initialized = true;
}
export function tune(pl1, pl2) {
  if (!initialized || pl1 !== 37 || pl2 !== 106) throw new Error('Invalid CPU tuning request');
}
export function cpuocCleanup() { initialized = false; }
`;

const runner = `
import { fileURLToPath } from 'node:url';
const build = Bun.build;
// Linux release builds omit the Windows worker. Include it in this fixture
// so the host's executable can exercise the Windows worker embedding layout.
Bun.build = options => build({
  ...options,
  entrypoints: [...new Set([...options.entrypoints, fileURLToPath(new URL('./native/windows/hardware.worker.ts', import.meta.url))])],
});
await import('./build.ts');
`;

// Run the production entrypoint with an explicitly denied token and trap every
// hardware initialization/listener attempt. The test build replaces dependencies;
// production has no environment switch that bypasses its permission gate.
const permissionRunner = `
import path from 'node:path';
const directory = import.meta.dirname;
const source = ${JSON.stringify(path.join(import.meta.dirname, "index.ts"))};
const executable = path.join(directory, process.platform === 'win32' ? 'gate.exe' : 'gate');
const plugins = [{ name: 'permission-boundary-fixture', setup(build) {
  build.onLoad({ filter: /[\\\\/]server[\\\\/]permissions\\.ts$/ }, () => ({ loader: 'ts', contents:
    'export async function isElevated() { console.log("TRACE token-check"); return Bun.env.ALFC_TEST_GRANTED === "1"; }' }));
  build.onLoad({ filter: /[\\\\/]server[\\\\/]native[\\\\/]index\\.ts$/ }, () => ({ loader: 'ts', contents:
    'function trap() { throw new Error("UNEXPECTED_HARDWARE_INITIALIZATION"); } export const initNativeServices = trap; export async function cleanupNativeServices() {} export async function drainNativeCalls() {} export const getCall = trap; export const setCall = trap; export const tune = trap;' }));
  build.onLoad({ filter: /[\\\\/]server[\\\\/]state[\\\\/]index\\.ts$/ }, () => ({ loader: 'ts', contents:
    'export const state = { isFanControlAvailable: false }; export async function persistState() {}' }));
}}];
const options = {
  entrypoints: [source], target: 'bun', plugins,
  banner: 'Bun.serve = () => { throw new Error("UNEXPECTED_LISTENER"); };',
};
for (const compile of [false, true]) {
  const result = await Bun.build({ ...options, ...(compile
    ? { compile: { outfile: executable, autoloadDotenv: false, autoloadBunfig: false } }
    : { outdir: path.join(directory, 'source') }) });
  if (!result.success) throw new Error(result.logs.join('\\n'));
}
`;

describe("Bun runtime", () => {
  it("rejects a denied token before native initialization or listening in source and compiled entrypoints", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "alfc-gate-"));
    try {
      await writeFile(path.join(directory, "runner.ts"), permissionRunner);
      await execute("bun", [path.join(directory, "runner.ts")], {
        timeout: 20_000,
        windowsHide: true,
      });
      const source = [path.join(directory, "source/index.js")];
      const executable = path.join(
        directory,
        process.platform === "win32" ? "gate.exe" : "gate",
      );
      for (const [command, args] of [
        ["bun", source],
        [executable, []],
      ] as const) {
        await expect(
          execute(command, args, {
            env: {
              ...process.env,
              NODE_ENV: "production",
              ALFC_TEST_GRANTED: "0",
            },
            timeout: 10_000,
            windowsHide: true,
          }),
        ).rejects.toMatchObject({
          code: 1,
          stdout: expect.stringContaining(
            "This needs to be run with elevated privileges.",
          ),
          stderr: "",
        });
      }
      // Negative control proves the real entrypoint reaches the trap as soon as
      // the fixture token is admitted; the denied test cannot pass on an inert app.
      await expect(
        execute("bun", source, {
          env: {
            ...process.env,
            NODE_ENV: "production",
            ALFC_TEST_GRANTED: "1",
          },
          timeout: 10_000,
          windowsHide: true,
        }),
      ).rejects.toMatchObject({
        code: 1,
        stdout: expect.stringContaining("TRACE token-check"),
        stderr: expect.stringContaining("UNEXPECTED_HARDWARE_INITIALIZATION"),
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 35_000);

  it("runs source production and packaged workers with the correct resources", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "alfc-build-"));
    try {
      await Promise.all([
        mkdir(path.join(directory, "native/windows"), { recursive: true }),
        mkdir(path.join(directory, "utils")),
        mkdir(path.join(directory, "working-directory")),
      ]);
      const copiedFiles = [
        "build.ts",
        "utils/consts.ts",
        "native/windows/hardware.ts",
        "native/windows/hardware.worker.ts",
        "native/windows/hardware-protocol.ts",
      ];
      await Promise.all([
        ...copiedFiles.map((name) =>
          copyFile(
            path.join(import.meta.dirname, name),
            path.join(directory, name),
          ),
        ),
        writeFile(path.join(directory, "index.ts"), fixture),
        writeFile(path.join(directory, "runner.ts"), runner),
        writeFile(path.join(directory, "native/windows/acpi.ts"), acpiFixture),
        writeFile(path.join(directory, "native/windows/cpuoc.ts"), cpuFixture),
        writeFile(
          path.join(directory, "working-directory/.env"),
          "ALFC_BUILD_FIXTURE_DOTENV=unexpected\n",
        ),
        writeFile(
          path.join(directory, "working-directory/bunfig.toml"),
          'preload = ["./preload.ts"]\n',
        ),
        writeFile(
          path.join(directory, "working-directory/preload.ts"),
          'globalThis.__alfcBuildFixturePreload = "unexpected";\n',
        ),
      ]);
      const { stdout: sourceOutput } = await execute(
        "bun",
        [path.join(directory, "index.ts"), "--source"],
        {
          cwd: directory,
          env: { ...process.env, NODE_ENV: "production" },
          timeout: 10_000,
          windowsHide: true,
        },
      );
      expect(sourceOutput).toContain(
        "PASS runtime paths and independent hardware workers",
      );
      await execute("bun", [path.join(directory, "runner.ts")], {
        cwd: directory,
        timeout: 20_000,
        windowsHide: true,
      });
      const executable = process.platform === "win32" ? "alfc.exe" : "alfc";
      const { stdout } = await execute(
        path.join(directory, "dist", executable),
        [],
        {
          cwd: path.join(directory, "working-directory"),
          timeout: 10_000,
          windowsHide: true,
        },
      );
      expect(stdout).toContain(
        "PASS runtime paths and independent hardware workers",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 35_000);
});
