import {
  cleanupNativeServices,
  drainNativeCalls,
  initNativeServices,
} from "./native/index";
import { state } from "./state/index";
import { frontendDir, isDev } from "./utils/consts";
import {
  websocketHandlers,
  setServers,
  startWebSocketShutdown,
} from "./websocket/index";
import {
  awaitFanControlIdle,
  isFanControlRestoreRequired,
  restoreAutoFanControl,
  startFanControlShutdown,
} from "./fan-control/index";
import { handleWebSocketRequest, serveFrontendAsset } from "./http";
import { isElevated } from "./permissions";
import { listenOnLoopback } from "./listeners";

const PORT = 5522;
const DRAIN_TIMEOUT_MS = 5_000;
const RESTORE_FAN_TIMEOUT_MS = 5_000;
const CLEANUP_TIMEOUT_MS = 2_000;

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

const servers: Bun.Server<undefined>[] = [];
let nativeInitialization: Promise<void> | undefined;
let isShuttingDown = false;
let shutdownPromise: Promise<void> | undefined;
let shutdownExitCode = 0;

function withShutdownTimeout<T>(
  operation: Promise<T>,
  timeout: number,
  stage: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${stage} timed out after ${timeout}ms`)),
      timeout,
    );
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function shutdown(code: number): Promise<void> {
  shutdownExitCode = Math.max(shutdownExitCode, code);
  if (shutdownPromise) return shutdownPromise;

  isShuttingDown = true;
  startFanControlShutdown();
  const mutationsDrained = startWebSocketShutdown();
  setServers([]);

  shutdownPromise = Promise.resolve().then(async () => {
    // Register a hard deadline before awaiting anything: hardware calls can
    // stall, and WinSW only grants 15 seconds for graceful service shutdown.
    const deadline = setTimeout(
      () => {
        console.error(
          "[Server] Shutdown timed out while restoring fan control.",
        );
        process.exit(1);
      },
      DRAIN_TIMEOUT_MS + RESTORE_FAN_TIMEOUT_MS + CLEANUP_TIMEOUT_MS,
    );
    // Each callback turns even a synchronous stop error into a rejection. One
    // failed listener must not prevent closing the others or restoring BIOS.
    const connectionsClosed = servers.map(
      async (server) => await server.stop(true),
    );

    try {
      // Stop accepting work first, then finish admitted mutations and fan
      // writes so none can switch the fans back to fixed mode after restore.
      await withShutdownTimeout(
        (async () => {
          const drained = await Promise.allSettled([
            ...connectionsClosed,
            mutationsDrained,
            nativeInitialization,
          ]);
          for (const result of drained) {
            if (result.status === "rejected") {
              console.error(
                "[Server] Pending operation failed:",
                result.reason,
              );
              shutdownExitCode = 1;
            }
          }
          await awaitFanControlIdle();
          await drainNativeCalls();
        })(),
        DRAIN_TIMEOUT_MS,
        "Draining pending work",
      );
    } catch (error) {
      console.error("[Server] Failed to drain pending work on exit:", error);
      shutdownExitCode = 1;
    }

    // Even a failed drain must attempt the BIOS handoff. The native queue
    // preserves write ordering, and the restore has its own bounded budget.
    try {
      if (
        nativeInitialization &&
        (state.isFanControlAvailable !== false || isFanControlRestoreRequired())
      ) {
        await withShutdownTimeout(
          restoreAutoFanControl(),
          RESTORE_FAN_TIMEOUT_MS,
          "Restoring fan control",
        );
      }
    } catch (error) {
      console.error("[Server] Failed to restore fan control on exit:", error);
      shutdownExitCode = 1;
    } finally {
      try {
        await withShutdownTimeout(
          cleanupNativeServices(),
          CLEANUP_TIMEOUT_MS,
          "Cleaning up native services",
        );
      } catch (error) {
        console.error("[Server] Failed to clean up native services:", error);
        shutdownExitCode = 1;
      }
      clearTimeout(deadline);
      process.exit(shutdownExitCode);
    }
  });

  return shutdownPromise;
}

// Register safety handlers before initialization can start changing hardware.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    console.log(`[Server] Received ${signal}, shutting down...`);
    void shutdown(0);
  });
}
process.on("uncaughtException", (error) => {
  console.error("[Server] Uncaught exception:", error);
  void shutdown(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("[Server] Unhandled rejection:", reason);
  void shutdown(1);
});

async function runServer() {
  console.log("[Server] Checking permissions...");

  if (!(await isElevated())) {
    return exitWithError();
  }
  if (isShuttingDown) return;

  console.log("[Server] Initializing fan control...");
  nativeInitialization = initNativeServices(() => isShuttingDown);
  await nativeInitialization;
  if (isShuttingDown) return;

  console.log("[Server] Starting server...");

  const options = {
    port: PORT,

    fetch(req: Request, server: Bun.Server<undefined>) {
      if (isShuttingDown) {
        return new Response("Service Unavailable", { status: 503 });
      }
      const url = new URL(req.url);

      const webSocketResponse = handleWebSocketRequest(req, server);
      if (webSocketResponse !== null) return webSocketResponse;

      if (req.method !== "GET" && req.method !== "HEAD") {
        return new Response("Method Not Allowed", {
          status: 405,
          headers: { Allow: "GET, HEAD" },
        });
      }

      if (!isDev) {
        return serveFrontendAsset(frontendDir, url.pathname);
      }

      return new Response("Nothing to see here.");
    },

    websocket: websocketHandlers,
  } satisfies Bun.Serve.Options<undefined>;

  const listeners = await listenOnLoopback(options);
  servers.push(...listeners);
  if (isShuttingDown) {
    await Promise.allSettled(
      listeners.map(async (server) => await server.stop(true)),
    );
    return;
  }

  setServers(servers);

  console.log(
    `[Server] Start finished - UI available @ http://localhost:${PORT}`,
  );
}

void runServer().catch((error: unknown) => {
  console.error("[Server] Startup failed:", error);
  void shutdown(1);
});
