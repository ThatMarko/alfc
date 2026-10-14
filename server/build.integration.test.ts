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

assert.equal(isCompiledBinary, true);
assert.equal(isDev, false);
assert.equal(frontendDir, path.join(path.dirname(process.execPath), 'frontend'));
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
console.log('PASS compiled paths, isolated config and independent hardware workers');
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

describe("compiled Bun runtime", () => {
  it("uses packaged settings and embeds independent hardware workers", async () => {
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
        "PASS compiled paths, isolated config and independent hardware workers",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 35_000);
});
