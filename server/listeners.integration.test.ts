import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "..");

// Vitest uses Node and replaces global.Bun in test-setup.ts. Run the production
// listener and WebSocket code in a real Bun process; only hardware is replaced.
const networkFixture = `
import assert from 'node:assert/strict';
import { listenOnLoopback } from ${JSON.stringify(path.join(repositoryRoot, "server/listeners.ts"))};
import { websocketHandlers, setServers, publishActivity } from ${JSON.stringify(path.join(repositoryRoot, "server/websocket/index.ts"))};

function optionalIPv6(error) {
  return ['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'ENODEV'].includes(error?.code);
}
async function until(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    assert(Date.now() < deadline, 'Timed out waiting for a WebSocket response');
    await Bun.sleep(5);
  }
}
async function client(url) {
  const socket = new WebSocket(url);
  const messages = [];
  socket.onmessage = event => messages.push(event.data === 'pong' ? 'pong' : JSON.parse(event.data));
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  await until(() => messages.some(message => message.kind === 'state'));
  return { socket, messages };
}
const options = {
  port: 0,
  fetch(request, server) {
    if (new URL(request.url).pathname === '/ws') {
      if (server.upgrade(request)) return;
      return new Response('Upgrade failed', { status: 400 });
    }
    return new Response('ALFC loopback');
  },
  websocket: websocketHandlers,
};
const servers = await listenOnLoopback(options);
const clients = [];
try {
  setServers(servers);
  assert.equal(servers[0].hostname, '127.0.0.1');
  assert.equal(await (await fetch(servers[0].url)).text(), 'ALFC loopback');
  clients.push(await client('ws://127.0.0.1:' + servers[0].port + '/ws'));
  if (servers.length === 2) {
    assert.equal(servers[1].hostname, '::1');
    assert.equal(servers[1].port, servers[0].port, 'Both loopback families must use the same port');
    assert.equal(await (await fetch(servers[1].url)).text(), 'ALFC loopback');
    clients.push(await client('ws://[::1]:' + servers[1].port + '/ws'));
  } else console.log('IPv6 unavailable: verified the documented IPv4 fallback');
  for (const [index, percentage] of [61, 73].entries()) {
    const source = clients[index % clients.length];
    const requestId = 'mutation-' + index;
    source.socket.send(JSON.stringify({ kind: 'fixedpercentage', data: percentage, requestId }));
    await until(() => source.messages.some(message => message.kind === 'success' && message.requestId === requestId));
    await until(() => clients.every(client => client.messages.some(message => message.kind === 'state' && message.data.fixedPercentage === percentage)));
    for (const client of clients) assert.equal(client.messages.filter(message => message.kind === 'state' && message.data.fixedPercentage === percentage).length, 1);
  }
  for (const client of clients) {
    client.socket.send(JSON.stringify({ kind: 'registeractivitysocket' }));
    client.socket.send('ping');
  }
  await until(() => clients.every(client => client.messages.includes('pong')));
  const activity = { appliedSpeed: 73, avgCPUTemp: 48, avgGPUTemp: 46, target: 73 };
  publishActivity(activity);
  await until(() => clients.every(client => client.messages.some(message => message.kind === 'fancontrolactivity')));
  for (const client of clients) assert.deepEqual(client.messages.find(message => message.kind === 'fancontrolactivity').data, activity);
  console.log('PASS real loopback HTTP, WebSocket mutations, and telemetry on ' + servers.length + ' address families');
} finally {
  setServers([]);
  for (const client of clients) client.socket.close();
  await Promise.all(servers.map(server => server.stop(true)));
}

// Keep IPv6 occupied while IPv4 is free. Startup must roll back its owned IPv4
// socket and preserve the foreign IPv6 listener rather than silently degrading.
let occupied;
try {
  occupied = Bun.serve({ port: 0, hostname: '::1', ipv6Only: true, fetch() { return new Response('foreign'); } });
} catch (error) {
  if (!optionalIPv6(error)) throw error;
  console.log('IPv6 unavailable: conflict check cannot run on this host');
}
if (occupied) {
  try {
    const port = occupied.port;
    await assert.rejects(listenOnLoopback({ ...options, port }), error => error.code === 'EADDRINUSE');
    const replacement = Bun.serve({ port, hostname: '127.0.0.1', fetch() { return new Response('replacement'); } });
    await replacement.stop(true);
    assert.equal(await (await fetch(occupied.url)).text(), 'foreign');
    console.log('PASS IPv6 conflict rolls back IPv4 and preserves the foreign listener');
  } finally { await occupied.stop(true); }
}
`;

const runner = `
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const directory = import.meta.dirname;
const result = await Bun.build({
  entrypoints: [path.join(directory, 'fixture.ts')], target: 'bun', outdir: path.join(directory, 'bundle'),
  plugins: [{ name: 'hardware-fixtures', setup(build) {
    build.onLoad({ filter: /[\\\\/]server[\\\\/]native[\\\\/]index\\.ts$/ }, () => ({ loader: 'ts', contents:
      'export async function getCall() { return 45; } export async function setCall() {} export async function tune() {}' }));
    build.onLoad({ filter: /[\\\\/]server[\\\\/]fan-control[\\\\/]index\\.ts$/ }, () => ({ loader: 'ts', contents:
      'export async function applyFixedFan() {}' }));
    build.onLoad({ filter: /[\\\\/]server[\\\\/]state[\\\\/]index\\.ts$/ }, () => ({ loader: 'ts', contents:
      'export const state = { protocolVersion: "1.1", cpuFanTable: [[40,15],[88,100]], gpuFanTable: [[40,15],[83,100]], doFixedSpeed: false, fixedPercentage: 50, gpuBoost: false, pl1: 37, pl2: 106, isFanControlAvailable: true, isCpuTuningAvailable: true, isGpuBoostAvailable: true }; export async function persistState() {}' }));
  }}],
});
if (!result.success) throw new Error(result.logs.join('\\n'));
await import(pathToFileURL(path.join(directory, 'bundle', 'fixture.js')).href);
`;

const shutdownRunner = `
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const directory = import.meta.dirname;
const result = await Bun.build({
  entrypoints: [${JSON.stringify(path.join(repositoryRoot, "server/index.ts"))}], target: 'bun', outdir: path.join(directory, 'bundle'),
  banner: \`Bun.serve = options => ({ port: 5522, stop(force) {
    console.log('TRACE stop:' + options.hostname + ':' + force);
    if (options.hostname === '127.0.0.1') throw new Error('Intentional synchronous stop failure');
    return Promise.resolve();
  } });\`,
  plugins: [{ name: 'shutdown-fixtures', setup(build) {
    build.onLoad({ filter: /[\\\\/]server[\\\\/]permissions\\.ts$/ }, () => ({ loader: 'ts', contents:
      'export async function isElevated() { return true; }' }));
    build.onLoad({ filter: /[\\\\/]server[\\\\/]native[\\\\/]index\\.ts$/ }, () => ({ loader: 'ts', contents:
      'export async function initNativeServices() {} export async function drainNativeCalls() {} export async function cleanupNativeServices() { console.log("TRACE cleanup"); }' }));
    build.onLoad({ filter: /[\\\\/]server[\\\\/]state[\\\\/]index\\.ts$/ }, () => ({ loader: 'ts', contents:
      'export const state = { isFanControlAvailable: true };' }));
    build.onLoad({ filter: /[\\\\/]server[\\\\/]fan-control[\\\\/]index\\.ts$/ }, () => ({ loader: 'ts', contents:
      'export function startFanControlShutdown() {} export async function awaitFanControlIdle() {} export function isFanControlRestoreRequired() { return false; } export async function restoreAutoFanControl() { console.log("TRACE restore.fixed"); await Bun.sleep(1); console.log("TRACE restore.auto"); }' }));
    build.onLoad({ filter: /[\\\\/]server[\\\\/]websocket[\\\\/]index\\.ts$/ }, () => ({ loader: 'ts', contents:
      'export const websocketHandlers = { message() {} }; export async function startWebSocketShutdown() {} export function setServers(servers) { if (servers.length > 0) setTimeout(() => process.emit("SIGTERM"), 0); else console.log("TRACE registry.clear"); }' }));
  }}],
});
if (!result.success) throw new Error(result.logs.join('\\n'));
await import(pathToFileURL(path.join(directory, 'bundle', 'index.js')).href);
`;

describe("real Bun loopback networking", () => {
  it("keeps IPv4 and IPv6 clients in sync and rolls back a partial bind", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "alfc-listeners-"));
    try {
      await writeFile(path.join(directory, "fixture.ts"), networkFixture);
      await writeFile(path.join(directory, "runner.ts"), runner);
      const { stdout } = await execute(
        "bun",
        [path.join(directory, "runner.ts")],
        {
          timeout: 15_000,
          windowsHide: true,
        },
      );
      expect(stdout).toContain(
        "PASS real loopback HTTP, WebSocket mutations, and telemetry",
      );
      expect(stdout).toMatch(
        /PASS IPv6 conflict|IPv6 unavailable: conflict check/,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);

  it("restores BIOS control and closes the second listener after a synchronous stop failure", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "alfc-shutdown-"));
    try {
      await writeFile(path.join(directory, "runner.ts"), shutdownRunner);
      let failure: unknown;
      let output: string | undefined;
      try {
        const result = await execute(
          "bun",
          [path.join(directory, "runner.ts")],
          {
            timeout: 15_000,
            windowsHide: true,
          },
        );
        output = result.stdout;
      } catch (error) {
        failure = error;
      }
      expect(failure, output).toMatchObject({
        code: 1,
        stdout: expect.stringMatching(
          /registry.clear[\s\S]*stop:127\.0\.0\.1:true[\s\S]*stop:::1:true[\s\S]*restore.fixed[\s\S]*restore.auto[\s\S]*cleanup/,
        ),
        stderr: expect.stringContaining("Intentional synchronous stop failure"),
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);
});
