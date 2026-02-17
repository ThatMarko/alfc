import path from "node:path";
import { initNativeServices } from "./native/index";
import { isDev } from "./utils/consts";
import { websocketHandlers, setServer } from "./websocket/index";
import {
  restoreAutoFanControl,
  startFanControlShutdown,
} from "./fan-control/index";

const PORT = 5522;

const LOCALHOST_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isAllowedWebSocketOrigin(origin: string | null): boolean {
  if (origin === null) {
    return true;
  }

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch (_) {
    return false;
  }

  const isHttp =
    parsedOrigin.protocol === "http:" || parsedOrigin.protocol === "https:";

  if (!isHttp) {
    return false;
  }

  const hasUnexpectedSuffix =
    parsedOrigin.pathname !== "/" ||
    parsedOrigin.search !== "" ||
    parsedOrigin.hash !== "";

  if (hasUnexpectedSuffix) {
    return false;
  }

  return LOCALHOST_HOSTNAMES.has(parsedOrigin.hostname);
}

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
  console.log("[Server] Checking permissions...");

  if (!isElevated()) {
    exitWithError();
  }

  console.log("[Server] Initializing fan control...");
  await initNativeServices();

  let isShuttingDown = false;
  let hasRestoredAutoFanControl = false;
  const originalProcessExit = process.exit;
  process.exit = ((code?: number) => {
    if (isShuttingDown) {
      console.log(
        "[Server] Shutdown already in progress, ignoring duplicate exit.",
      );
      return;
    }

    isShuttingDown = true;
    startFanControlShutdown();

    (async () => {
      try {
        if (!hasRestoredAutoFanControl) {
          hasRestoredAutoFanControl = true;
          await restoreAutoFanControl();
        }

        if (code !== 0) {
          console.error("[Server] Exiting with code " + code);
          console.error(new Error().stack);
        } else {
          console.log("[Server] Exiting normally.");
        }
      } catch (err) {
        console.error("[Server] Failed to restore fan control on exit:", err);
      } finally {
        originalProcessExit(code ?? 1);
      }
    })();
  }) as (code?: number) => never;

  const runtimeRoot = isDev
    ? import.meta.dirname
    : path.dirname(process.execPath);

  const frontendDir = path.join(runtimeRoot, "frontend");

  console.log("[Server] Starting server...");

  const server = Bun.serve({
    port: PORT,
    hostname: "localhost",

    async fetch(req, server) {
      const url = new URL(req.url);

      if (url.pathname === "/ws") {
        const origin = req.headers.get("origin");
        if (!isAllowedWebSocketOrigin(origin)) {
          console.warn(`[WebSocket] Origin rejected: ${origin}`);
          return new Response("Forbidden", { status: 403 });
        }

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

    websocket: {
      ...websocketHandlers,
      idleTimeout: 30,
      backpressureLimit: 1024 * 1024,
    },
  });

  setServer(server);

  const shutdown = (signal: string) => {
    console.log(`[Server] Received ${signal}, shutting down...`);
    server.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGHUP", () => shutdown("SIGHUP"));

  process.on("uncaughtException", (err) => {
    console.error("[Server] Uncaught exception:", err);
    server.stop();
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    console.error("[Server] Unhandled rejection:", reason);
    server.stop();
    process.exit(1);
  });

  console.log(
    `[Server] Start finished - UI available @ http://localhost:${PORT}`,
  );
})();
