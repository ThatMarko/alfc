import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "..");

// Use a separate Node TCP reader so the test does not depend on the WebSocket
// client's buffering implementation. net.Socket.pause() pauses incoming reads:
// https://nodejs.org/docs/latest-v24.x/api/net.html#socketpause
const pausedTcpClient = String.raw`
import assert from 'node:assert/strict';
import { connect } from 'node:net';

const port = Number(process.argv[1]);
const socket = connect({ host: '127.0.0.1', port });
const deadline = setTimeout(() => {
  console.error('Paused TCP client exceeded its lifetime');
  process.exitCode = 1;
  finish();
}, 10000);
function finish() {
  clearTimeout(deadline);
  socket.destroy();
  process.stdin.destroy();
}
socket.on('error', error => {
  console.error(error);
  process.exitCode = 1;
  finish();
});
socket.on('connect', () => {
  socket.write([
    'GET /ws HTTP/1.1',
    'Host: 127.0.0.1:' + port,
    'Connection: Upgrade',
    'Upgrade: websocket',
    'Sec-WebSocket-Version: 13',
    'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
    '', '',
  ].join('\r\n'));
});
let received = Buffer.alloc(0);
function readUpgrade(chunk) {
  received = Buffer.concat([received, chunk]);
  const headerEnd = received.indexOf('\r\n\r\n');
  if (headerEnd === -1) return;
  assert.match(received.subarray(0, headerEnd).toString(), /^HTTP\/1\.1 101 /);
  socket.pause();
  socket.removeListener('data', readUpgrade);
  assert(socket.isPaused());
  process.stdout.write('READY\n');
}
socket.on('data', readUpgrade);
// The Bun parent closes this pipe only after checking native backpressure.
process.stdin.resume();
process.stdin.on('end', finish);
`;

// Vitest uses Node and replaces global.Bun in test-setup.ts. Run the production
// listener and WebSocket code in a real Bun process; only hardware is replaced.
const networkFixture = `
import assert from 'node:assert/strict';
import { listenOnLoopback } from ${JSON.stringify(path.join(repositoryRoot, "server/listeners.ts"))};
import { websocketHandlers, setServers, publishActivity, publishState } from ${JSON.stringify(path.join(repositoryRoot, "server/websocket/index.ts"))};
import { state } from ${JSON.stringify(path.join(repositoryRoot, "server/state/index.ts"))};

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
  const source = clients[0];
  source.socket.send(Buffer.concat([
    Buffer.from('{"kind":"fixedpercentage","data":99,"requestId":"invalid-'),
    Buffer.from([0xff]),
    Buffer.from('"}'),
  ]));
  await until(() => source.messages.some(message => message.kind === 'error' && message.data.startsWith('INVALID_JSON:')));
  assert.equal(state.fixedPercentage, 73, 'Malformed binary UTF-8 must not execute a mutation');
  const binaryRequestId = 'binary-温度-🌡';
  source.socket.send(Buffer.from(JSON.stringify({ kind: 'fixedpercentage', data: 74, requestId: binaryRequestId })));
  await until(() => source.messages.some(message => message.kind === 'success' && message.requestId === binaryRequestId));
  const prefix = '{"kind":"fixedpercentage","data":75,"requestId":"at-limit","padding":"';
  const suffix = '"}';
  const paddingBytes = 64 * 1024 - Buffer.byteLength(prefix + suffix);
  const atLimit = prefix + 'é'.repeat(Math.floor(paddingBytes / 2)) + 'x'.repeat(paddingBytes % 2) + suffix;
  assert.equal(Buffer.byteLength(atLimit), 64 * 1024);
  source.socket.send(atLimit);
  await until(() => source.messages.some(message => message.kind === 'success' && message.requestId === 'at-limit'));
  source.socket.send(Buffer.from(atLimit.replace('at-limit', 'binlimit')));
  await until(() => source.messages.some(message => message.kind === 'success' && message.requestId === 'binlimit'));
  for (const binary of [false, true]) {
    const oversized = await client('ws://127.0.0.1:' + servers[0].port + '/ws');
    clients.push(oversized);
    const message = atLimit.replace('at-limit', 'too-large').replace('"data":75', '"data":99');
    assert.equal(Buffer.byteLength(message), 64 * 1024 + 1);
    oversized.socket.send(binary ? Buffer.from(message) : message);
    await until(() => oversized.socket.readyState === WebSocket.CLOSED);
    assert(!oversized.messages.some(message => message.requestId === 'too-large'));
  }
  assert.equal(state.fixedPercentage, 75, 'Oversized text and binary messages must not reach a handler');
  const connected = clients.filter(client => client.socket.readyState === WebSocket.OPEN);
  for (const client of connected) {
    client.socket.send(JSON.stringify({ kind: 'registeractivitysocket' }));
    client.socket.send('ping');
  }
  await until(() => connected.every(client => client.messages.includes('pong')));
  const activity = { appliedSpeed: 73, avgCPUTemp: 48, avgGPUTemp: 46, target: 73 };
  publishActivity(activity);
  await until(() => connected.every(client => client.messages.some(message => message.kind === 'fancontrolactivity')));
  for (const client of connected) assert.deepEqual(client.messages.find(message => message.kind === 'fancontrolactivity').data, activity);
  console.log('PASS UTF-8 binary validation and exact 64 KiB text/binary payload limit');
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

// A separate Node TCP client completes the upgrade and stops reading before
// publishing starts. Only the receiver changes; Bun's native pub/sub and the
// production backpressure configuration remain under test on every platform.
let pressureSocket;
let pressureClosed = false;
const pressureServer = Bun.serve({
  ...options, hostname: '127.0.0.1',
  websocket: {
    ...websocketHandlers,
    open(ws) { pressureSocket = ws; websocketHandlers.open(ws); },
    close(ws, code, reason) { pressureClosed = true; websocketHandlers.close(ws, code, reason); },
  },
});
try {
  const slowClient = Bun.spawn([
    ${JSON.stringify(process.execPath)}, '--input-type=module', '-e',
    ${JSON.stringify(pausedTcpClient)}, String(pressureServer.port),
  ], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', windowsHide: true });
  const clientErrors = new Response(slowClient.stderr).text();
  try {
    const reader = slowClient.stdout.getReader();
    let readiness = '';
    try {
      while (!readiness.includes('\\n')) {
        const { value, done } = await reader.read();
        if (done) throw new Error('Paused TCP client did not become ready: ' + await clientErrors);
        readiness += new TextDecoder().decode(value);
      }
    } finally { reader.releaseLock(); }
    assert.equal(readiness.trim(), 'READY');
    await until(() => pressureSocket !== undefined);
    // A large, valid curve exercises the same confirmed-state publication as
    // production, including its application guard around native pub/sub.
    state.cpuFanTable = Array.from({ length: 4096 }, (_, index) => [index / 40, 50]);
    const messageBytes = Buffer.byteLength(JSON.stringify({ kind: 'state', data: state }));
    assert(messageBytes <= 64 * 1024, 'The pressure fixture snapshot must fit the input budget');
    setServers([pressureServer]);
    let peakBufferedBytes = 0;
    let publishedFrames = 0;
    for (; publishedFrames < 512 && !pressureClosed; publishedFrames++) {
      publishState();
      await Bun.sleep(1);
      peakBufferedBytes = Math.max(peakBufferedBytes, pressureSocket.getBufferedAmount());
    }
    const pressureDetails = ' (peakBufferedBytes=' + peakBufferedBytes + ', readyState=' + pressureSocket.readyState + ', publishedFrames=' + publishedFrames + ')';
    assert(pressureClosed, 'A slow subscriber must close when outbound buffering exceeds 1 MiB' + pressureDetails);
    assert(peakBufferedBytes <= 1024 * 1024 + messageBytes, 'Native buffering must remain within the 1 MiB budget plus one frame' + pressureDetails);
    console.log('PASS native pub/sub closes a paused TCP subscriber at the backpressure limit' + pressureDetails);
  } finally {
    slowClient.stdin.end();
    const exitCode = await slowClient.exited;
    assert.equal(exitCode, 0, await clientErrors);
  }
} finally {
  setServers([]);
  await pressureServer.stop(true);
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
      expect(stdout).toContain(
        "PASS UTF-8 binary validation and exact 64 KiB text/binary payload limit",
      );
      expect(stdout).toContain(
        "PASS native pub/sub closes a paused TCP subscriber at the backpressure limit",
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
