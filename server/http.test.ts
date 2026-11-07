import path from "node:path";
import {
  createHttpHandler,
  isAllowedHost,
  isAllowedWebSocketOrigin,
  resolveFrontendPath,
} from "./http";

describe("WebSocket origins", () => {
  it.each([
    null,
    "http://localhost:5522",
    "https://127.0.0.1:5522",
    "http://[::1]:5522",
  ])("allows loopback browser and native origins: %s", (origin) => {
    expect(isAllowedWebSocketOrigin(origin)).toBe(true);
  });

  it("allows the dev UI origin only in dev mode", () => {
    expect(isAllowedWebSocketOrigin("http://localhost:3000")).toBe(false);
    expect(isAllowedWebSocketOrigin("http://localhost:3000", true)).toBe(true);
    expect(isAllowedWebSocketOrigin("http://localhost:5522", true)).toBe(true);
  });

  it.each([
    "null",
    "https://localhost.example.com",
    "https://example.com",
    "file:///localhost",
    "http://user:password@localhost:5522",
    "http://localhost/path",
    "http://localhost/?query=true",
    "http://localhost/#fragment",
    "http://localhost:8080",
    "http://localhost",
    "http://localhost:3000",
  ])("rejects non-loopback or malformed origins: %s", (origin) => {
    expect(isAllowedWebSocketOrigin(origin)).toBe(false);
  });
});

describe("Host header", () => {
  it.each([
    null,
    "localhost:5522",
    "127.0.0.1:5522",
    "[::1]:5522",
    "localhost:3000",
    "localhost",
  ])("allows loopback hosts: %s", (host) => {
    expect(isAllowedHost(host)).toBe(true);
  });

  it.each([
    "example.com:5522",
    "evil.com",
    "localhost:5522:5522",
    "user@localhost:5522",
    "user:pass@localhost:5522",
  ])("rejects other hosts: %s", (host) => {
    expect(isAllowedHost(host)).toBe(false);
  });
});

describe("HTTP handler", () => {
  it("rejects a non-loopback Host header with 403 before serving", async () => {
    const handler = createHttpHandler({
      frontendDir: path.resolve("frontend", "dist"),
      isDev: false,
      isShuttingDown: () => false,
    });
    // Bun's Request does not set Host from the URL at construction time,
    // so the header under test is set explicitly, as a real client sends it.
    const response = await handler(
      new Request("http://localhost:5522/", {
        headers: { host: "evil.com" },
      }),
      undefined as unknown as Bun.Server<undefined>,
    );
    expect(response?.status).toBe(403);
  });
});

describe("frontend asset paths", () => {
  const frontendDir = path.resolve("frontend", "dist");

  it("serves the document root and URL-encoded filenames", () => {
    expect(resolveFrontendPath(frontendDir, "/")).toEqual({
      filePath: path.join(frontendDir, "index.html"),
    });
    expect(
      resolveFrontendPath(frontendDir, "/assets/fan%20%CE%B1.svg"),
    ).toEqual({
      filePath: path.join(frontendDir, "assets", "fan α.svg"),
    });
  });

  it.each([
    "/../alfc.config.json",
    "/..%2falfc.config.json",
    "/assets/../..%2fsecret",
    "/..%5csecret",
    "/assets%5c..%5c..%5csecret",
  ])(
    "rejects paths outside the asset directory on Linux and Windows: %s",
    (pathname) => {
      expect(resolveFrontendPath(frontendDir, pathname)).toEqual({
        status: 403,
      });
    },
  );

  it.each(["/%", "/%FF", "/assets/%00.js"])(
    "rejects invalid path encodings before filesystem access: %s",
    (pathname) => {
      expect(resolveFrontendPath(frontendDir, pathname)).toEqual({
        status: 400,
      });
    },
  );
});
