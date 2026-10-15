import path from "node:path";
import { isAllowedWebSocketOrigin, resolveFrontendPath } from "./http";

describe("WebSocket origins", () => {
  it.each([
    null,
    "http://localhost:3000",
    "https://127.0.0.1:5522",
    "http://[::1]:5522",
  ])("allows loopback browser and native origins: %s", (origin) => {
    expect(isAllowedWebSocketOrigin(origin)).toBe(true);
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
  ])("rejects non-loopback or malformed origins: %s", (origin) => {
    expect(isAllowedWebSocketOrigin(origin)).toBe(false);
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
