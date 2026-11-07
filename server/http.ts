import path from "node:path";
import { realpath } from "node:fs/promises";

const LOCALHOST_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Keep source, packaged execution, and the hardware-free integration entrypoint
// on the same HTTP and upgrade boundary. Only index.ts owns privilege checks
// and hardware startup; this handler has no permission bypass or test routes.
export function createHttpHandler({
  frontendDir,
  isDev,
  isReady = () => true,
  isShuttingDown,
}: {
  frontendDir: string;
  isDev: boolean;
  isReady?: () => boolean;
  isShuttingDown: () => boolean;
}) {
  return (request: Request, server: Bun.Server<undefined>) => {
    if (!isReady() || isShuttingDown()) {
      return new Response("Service Unavailable", { status: 503 });
    }
    // A request addressed to another host (DNS rebinding: a hostile name
    // resolving to 127.0.0.1) must not receive the dashboard or a WebSocket
    // upgrade. Browsers always send Host; a missing header is a non-browser
    // client such as the Plasma widget.
    if (!isAllowedHost(request.headers.get("host"))) {
      return new Response("Forbidden", { status: 403 });
    }
    const webSocketResponse = handleWebSocketRequest(request, server, isDev);
    if (webSocketResponse !== null) return webSocketResponse;
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    }
    return isDev
      ? new Response("Nothing to see here.")
      : serveFrontendAsset(frontendDir, new URL(request.url).pathname);
  };
}

// null leaves non-WebSocket paths to the static HTTP handler; undefined means
// Bun accepted an upgrade and owns the response.
export function handleWebSocketRequest(
  request: Request,
  server: Pick<Bun.Server<undefined>, "upgrade">,
  isDev = false,
): Response | null | undefined {
  const pathname = new URL(request.url).pathname;
  if (pathname !== "/ws" && pathname !== "/ws/") return null;
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET" },
    });
  }
  const origin = request.headers.get("origin");
  if (!isAllowedWebSocketOrigin(origin, isDev)) {
    console.warn(`[WebSocket] Origin rejected: ${origin}`);
    return new Response("Forbidden", { status: 403 });
  }
  if (server.upgrade(request, { data: undefined })) return undefined;
  return new Response("WebSocket upgrade failed", { status: 400 });
}

export function isAllowedHost(host: string | null): boolean {
  // Browsers always send Host; a missing header means a non-browser client.
  if (host === null) return true;

  let parsed: URL;
  try {
    parsed = new URL(`http://${host}`);
  } catch (_) {
    return false;
  }

  // Only the hostname matters here: a request addressed to another host
  // (DNS rebinding: a hostile name resolving to 127.0.0.1) must not
  // receive the dashboard or a WebSocket upgrade. The port is the
  // listener's own port, which tests may override. Userinfo in Host is
  // never legitimate (browsers strip it), so reject it like the Origin
  // check does.
  return (
    parsed.username === "" &&
    parsed.password === "" &&
    LOCALHOST_HOSTNAMES.has(parsed.hostname)
  );
}

export function isAllowedWebSocketOrigin(
  origin: string | null,
  isDev = false,
): boolean {
  // Native clients (including the Plasma widget) do not send an Origin header.
  if (origin === null) return true;

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch (_) {
    return false;
  }

  // The backend listens on 5522; the dev UI runs on 3000. Any other
  // localhost port is another local service, not this dashboard, so it
  // must not drive hardware. An empty port is the scheme default (80/443),
  // which is never the dashboard either.
  const allowedPorts = isDev ? new Set(["5522", "3000"]) : new Set(["5522"]);
  return (
    (parsed.protocol === "http:" || parsed.protocol === "https:") &&
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.pathname === "/" &&
    parsed.search === "" &&
    parsed.hash === "" &&
    allowedPorts.has(parsed.port) &&
    LOCALHOST_HOSTNAMES.has(parsed.hostname)
  );
}

export function resolveFrontendPath(
  frontendDir: string,
  pathname: string,
): { filePath: string } | { status: 400 | 403 } {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (_) {
    return { status: 400 };
  }

  if (decoded.includes("\0")) return { status: 400 };
  // URLs use forward slashes. Reject Windows separators on every platform so
  // the same request cannot gain different filesystem meaning after deployment.
  if (decoded.includes("\\")) return { status: 403 };
  if (decoded === "/") decoded = "/index.html";

  // Decode before checking containment: encoded separators must not bypass
  // Windows path normalization, and real filenames may contain spaces/Unicode.
  const root = path.resolve(frontendDir);
  const filePath = path.resolve(root, "." + decoded);
  if (filePath === root || !filePath.startsWith(root + path.sep)) {
    return { status: 403 };
  }

  return { filePath };
}

export async function serveFrontendAsset(
  frontendDir: string,
  pathname: string,
): Promise<Response> {
  const resolved = resolveFrontendPath(frontendDir, pathname);
  if ("status" in resolved) {
    return new Response(resolved.status === 400 ? "Bad Request" : "Forbidden", {
      status: resolved.status,
    });
  }

  let root: string;
  let filePath: string;
  try {
    [root, filePath] = await Promise.all([
      realpath(frontendDir),
      realpath(resolved.filePath),
    ]);
  } catch (error) {
    const code =
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : undefined;
    // A missing asset and an unresolvable path are both "not found" to the
    // client; a permission failure is forbidden. Anything else (a failing
    // disk, a broken filesystem) is a server error, not a 404.
    if (
      code === "ENOENT" ||
      code === "ENOTDIR" ||
      code === "ENAMETOOLONG" ||
      code === "ELOOP"
    ) {
      return new Response("Not Found", { status: 404 });
    }
    if (code === "EACCES") {
      return new Response("Forbidden", { status: 403 });
    }
    throw error;
  }

  // The installed asset tree is trusted. Still check its real paths so a
  // symlink or Windows junction cannot expose a file outside that tree.
  // Resolve the root too, since a source build directory may itself be linked.
  const relative = path.relative(root, filePath);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(".." + path.sep) ||
    path.isAbsolute(relative)
  ) {
    return new Response("Forbidden", { status: 403 });
  }

  // A permitted link may change the target's extension. Keep MIME inference
  // based on the requested asset name while opening the checked real path.
  const file = Bun.file(filePath, { type: Bun.file(resolved.filePath).type });
  if (await file.exists()) return new Response(file);
  return new Response("Not Found", { status: 404 });
}
