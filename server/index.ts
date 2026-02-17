import path from "path";
import { initNativeServices } from "./native/index.js";
import { isDev } from "./utils/consts.js";
import { websocketHandlers, setServer } from "./websocket/index.js";
import { restoreAutoFanControl } from "./fan-control/index.js";

const PORT = 5522;

function isElevated(): boolean {
  if (process.platform === "win32") {
    const result = Bun.spawnSync(["net", "session"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    return result.exitCode === 0;
  }
  return process.getuid?.() === 0;
}

const exitWithError = () => {
  try {
    const message =
      "======================= NOTE ==========================\n" +
      "This needs to be run with elevated privileges.\n" +
      "=======================================================\n";

    process.stdout.write(message);

    if (process.stdout.writableNeedDrain) {
      process.stdout.once("drain", () => process.exit(1));
    } else {
      process.exit(1);
    }
  } catch (_) {
    process.exit(1);
  }
};

(async () => {
  console.log("Checking permissions...");

  if (!isElevated()) {
    exitWithError();
  }

  console.log("Initializing fan control...");
  await initNativeServices();

  let isShuttingDown = false;
  const originalProcessExit = process.exit;
  process.exit = ((code?: number) => {
    if (isShuttingDown) {
      originalProcessExit(code ?? 1);
      return;
    }
    isShuttingDown = true;
    try {
      restoreAutoFanControl();
      if (code !== 0) {
        console.error("Exiting with code " + code);
        console.error(new Error().stack);
      } else {
        console.log("Exiting normally.");
      }
    } catch (err) {
      console.error("Failed to restore fan control on exit:", err);
    }
    originalProcessExit(code ?? 1);
  }) as (code?: number) => never;

  const runtimeRoot = isDev
    ? import.meta.dirname
    : path.dirname(process.execPath);

  const frontendDir = path.join(runtimeRoot, "frontend");

  console.log("Starting server...");

  const server = Bun.serve({
    port: PORT,
    hostname: "localhost",

    async fetch(req, server) {
      const url = new URL(req.url);

      if (url.pathname === "/ws") {
        const upgraded = server.upgrade(req, { data: undefined });
        if (upgraded) return undefined;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      if (!isDev) {
        let pathname = url.pathname;
        if (pathname === "/") {
          pathname = "/index.html";
        }

        const filePath = path.join(frontendDir, pathname);

        if (!filePath.startsWith(frontendDir)) {
          return new Response("Forbidden", { status: 403 });
        }

        const file = Bun.file(filePath);
        if (await file.exists()) {
          return new Response(file);
        }

        return new Response("Not Found", { status: 404 });
      }

      return new Response("Nothing to see here.");
    },

    websocket: websocketHandlers,
  });

  setServer(server);

  const shutdown = (signal: string) => {
    console.log(`Received ${signal}, shutting down...`);
    server.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGHUP", () => shutdown("SIGHUP"));

  process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
    server.stop();
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection:", reason);
    server.stop();
    process.exit(1);
  });

  console.log(`Start finished - UI available @ http://localhost:${PORT}`);
})();
