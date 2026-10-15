import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const httpModule = path.join(import.meta.dirname, "http.ts");

// Exercise Bun's real file responses, symlink resolution and automatic HEAD
// handling. Importing this HTTP module does not initialize hardware.
const fixture = `
import assert from 'node:assert/strict';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { serveFrontendAsset } from ${JSON.stringify(httpModule)};

const directory = import.meta.dirname;
const root = path.join(directory, 'frontend');
const assets = path.join(root, 'assets');
const outside = path.join(directory, 'frontend-other');
await mkdir(assets, { recursive: true });
await mkdir(outside);
await writeFile(path.join(root, 'index.html'), '<h1>ALFC fixture</h1>');
await writeFile(path.join(assets, 'fan α.svg'), '<svg>fixture</svg>');
await writeFile(path.join(outside, 'private.txt'), 'outside asset root');
const linkType = process.platform === 'win32' ? 'junction' : 'dir';
await symlink(assets, path.join(root, 'inside'), linkType);
await symlink(outside, path.join(root, 'outside'), linkType);
const linkedRoot = path.join(directory, 'frontend-link');
await symlink(root, linkedRoot, linkType);

for (const frontendDir of [root, linkedRoot]) {
  const server = Bun.serve({
    port: 0, hostname: '127.0.0.1',
    fetch(request) {
      return serveFrontendAsset(frontendDir, new URL(request.url).pathname);
    },
  });
  try {
    const index = await fetch(server.url);
    assert.equal(index.status, 200);
    assert.equal(await index.text(), '<h1>ALFC fixture</h1>');
    assert.match(index.headers.get('content-type'), /^text\\/html/);
    for (const prefix of ['/assets/', '/inside/']) {
      const url = new URL(prefix + 'fan%20%CE%B1.svg', server.url);
      const get = await fetch(url);
      assert.equal(get.status, 200);
      assert.equal(await get.text(), '<svg>fixture</svg>');
      assert.match(get.headers.get('content-type'), /^image\\/svg\\+xml/);
      const head = await fetch(url, { method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal(await head.text(), '');
    }
    // A sibling sharing the root's prefix must still remain outside it.
    for (const method of ['GET', 'HEAD']) {
      const denied = await fetch(new URL('/outside/private.txt', server.url), { method });
      assert.equal(denied.status, 403, 'An external symlink/junction must not serve its target');
      assert.equal(await denied.text(), method === 'GET' ? 'Forbidden' : '');
    }
    for (const pathname of ['/missing.txt', '/assets/missing.svg', '/assets']) {
      assert.equal((await fetch(new URL(pathname, server.url))).status, 404);
    }
    assert.equal((await fetch(new URL('/..%2fprivate.txt', server.url))).status, 403);
    assert.equal((await fetch(new URL('/%FF', server.url))).status, 400);
  } finally {
    await server.stop(true);
  }
}
console.log('PASS static GET/HEAD, encoded assets and real-path containment for direct and linked roots');
`;

describe("real Bun static asset serving", () => {
  it("rejects symlink escapes while serving files and links inside the asset root", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "alfc-http-"));
    try {
      const entrypoint = path.join(directory, "fixture.ts");
      await writeFile(entrypoint, fixture);
      const { stdout } = await execute("bun", [entrypoint], {
        timeout: 10_000,
        windowsHide: true,
      });
      expect(stdout).toContain(
        "PASS static GET/HEAD, encoded assets and real-path containment for direct and linked roots",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
});
