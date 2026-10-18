import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "..");

// Run the production entrypoint, listeners, HTTP/WS handlers and shutdown in
// real Bun subprocesses. Only elevation and the hardware/state boundary change.
const runner = `
import assert from 'node:assert/strict';
import path from 'node:path';
const directory = import.meta.dirname;
const mode = process.argv[2];
const portFile = path.join(directory, 'port');
const startedFile = path.join(directory, 'started');
const releaseFile = path.join(directory, 'release');
const stopFile = path.join(directory, 'stop');
const result = await Bun.build({
  entrypoints: [${JSON.stringify(path.join(repositoryRoot, "server/index.ts"))}],
  target: 'bun', outdir: path.join(directory, 'bundle'),
  banner: \`const fixtureServe = Bun.serve;
    Bun.serve = options => {
      const server = fixtureServe({ ...options, port: options.hostname === '127.0.0.1'
        ? Number(Bun.env.ALFC_FIXTURE_PORT) : options.port });
      if (options.hostname === '127.0.0.1') void Bun.write(Bun.env.ALFC_FIXTURE_PORT_FILE, String(server.port));
      return server;
    };\`,
  plugins: [{ name: 'startup-hardware-fixtures', setup(build) {
    build.onLoad({ filter: /[\\\\/]server[\\\\/]permissions\\.ts$/ }, () => ({ loader: 'ts', contents:
      'export async function isElevated() { return true; }' }));
    build.onLoad({ filter: /[\\\\/]server[\\\\/]native[\\\\/]index\\.ts$/ }, () => ({ loader: 'ts', contents: \`
      export async function initNativeServices() {
        console.log('TRACE native.initialize');
        await Bun.write(Bun.env.ALFC_FIXTURE_STARTED_FILE, 'started');
        if (Bun.env.ALFC_FIXTURE_MODE === 'delayed') {
          while (!await Bun.file(Bun.env.ALFC_FIXTURE_RELEASE_FILE).exists()) await Bun.sleep(5);
          const stopCheck = setInterval(async () => {
            if (await Bun.file(Bun.env.ALFC_FIXTURE_STOP_FILE).exists()) {
              clearInterval(stopCheck);
              process.emit('SIGTERM');
            }
          }, 10);
        }
      }
      export async function getCall() { return 45; }
      export async function setCall(_id, method) { console.log('TRACE native.set:' + method); }
      export async function tune() {}
      export async function drainNativeCalls() {}
      export async function cleanupNativeServices() { console.log('TRACE native.cleanup'); }
    \` }));
    build.onLoad({ filter: /[\\\\/]server[\\\\/]state[\\\\/]index\\.ts$/ }, () => ({ loader: 'ts', contents:
      'export const state = { protocolVersion: "1.1", cpuFanTable: [[40,15],[88,100]], gpuFanTable: [[40,15],[83,100]], doFixedSpeed: false, fixedPercentage: 50, gpuBoost: false, pl1: 37, pl2: 106, isFanControlAvailable: true, isCpuTuningAvailable: true, isGpuBoostAvailable: true }; export async function persistState() {}' }));
  }}],
});
if (!result.success) throw new Error(result.logs.join('\\n'));
async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (!await predicate()) {
    assert(Date.now() < deadline, 'Timed out waiting for startup fixture');
    await Bun.sleep(5);
  }
}
const foreign = mode === 'occupied' ? Bun.serve({
  port: 0, hostname: '127.0.0.1', fetch() { return new Response('existing controller'); },
}) : undefined;
const child = Bun.spawn([process.execPath, path.join(directory, 'bundle', 'index.js')], {
  env: { ...process.env, NODE_ENV: 'development',
    ALFC_FIXTURE_MODE: mode, ALFC_FIXTURE_PORT: String(foreign?.port ?? 0),
    ALFC_FIXTURE_PORT_FILE: portFile, ALFC_FIXTURE_STARTED_FILE: startedFile,
    ALFC_FIXTURE_RELEASE_FILE: releaseFile, ALFC_FIXTURE_STOP_FILE: stopFile,
  }, stdout: 'pipe', stderr: 'pipe', windowsHide: true,
});
const output = new Response(child.stdout).text();
const errors = new Response(child.stderr).text();
try {
  if (foreign) {
    assert.equal(await child.exited, 1);
    const stdout = await output;
    assert(!stdout.includes('TRACE native.initialize'), 'A duplicate start must not initialize hardware: ' + stdout);
    assert(!stdout.includes('TRACE native.set:'), 'A duplicate start must not restore over an existing controller: ' + stdout);
    assert.equal(await (await fetch(foreign.url)).text(), 'existing controller');
    assert.match(await errors, /Startup failed/);
    console.log('PASS occupied control port rejects startup without initializing or restoring hardware');
  } else {
    await until(() => Bun.file(startedFile).exists());
    await until(() => Bun.file(portFile).exists());
    const url = 'http://127.0.0.1:' + await Bun.file(portFile).text();
    for (const pathname of ['/', '/ws', '/ws/']) {
      const response = await fetch(url + pathname, { headers: {
        Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      } });
      assert.equal(response.status, 503, 'Startup must reject HTTP and WS until hardware initialization completes');
    }
    await Bun.write(releaseFile, 'ready');
    await until(async () => (await fetch(url)).status === 200);
    const socket = new WebSocket(url.replace('http:', 'ws:') + '/ws');
    const snapshot = await new Promise((resolve, reject) => {
      socket.onmessage = event => resolve(JSON.parse(event.data));
      socket.onerror = reject;
    });
    assert.equal(snapshot.kind, 'state');
    socket.close();
    await Bun.write(stopFile, 'stop');
    assert.equal(await child.exited, 0, await errors);
    assert.match(await output, /native.initialize[\\s\\S]*native.set:SetFixedFanStatus[\\s\\S]*native.set:SetAutoFanStatus[\\s\\S]*native.cleanup/);
    console.log('PASS reserved listeners reject HTTP and WS until initialized, then serve and restore on shutdown');
  }
} finally {
  child.kill();
  await child.exited;
  await foreign?.stop(true);
}
`;

describe("real Bun service startup", () => {
  it.each(["occupied", "delayed"])(
    "preserves controller ownership during %s startup",
    async (mode) => {
      const directory = await mkdtemp(path.join(os.tmpdir(), "alfc-startup-"));
      try {
        await writeFile(path.join(directory, "runner.ts"), runner);
        const { stdout } = await execute(
          "bun",
          [path.join(directory, "runner.ts"), mode],
          { timeout: 15_000, windowsHide: true },
        );
        expect(stdout).toContain(
          mode === "occupied"
            ? "PASS occupied control port rejects startup without initializing or restoring hardware"
            : "PASS reserved listeners reject HTTP and WS until initialized, then serve and restore on shutdown",
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    20_000,
  );
});
