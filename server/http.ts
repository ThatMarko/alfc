import path from "node:path";

const LOCALHOST_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

// null leaves non-WebSocket paths to the static HTTP handler; undefined means
// Bun accepted an upgrade and owns the response.
export function handleWebSocketRequest(
  request: Request,
  server: Pick<Bun.Server<undefined>, "upgrade">,
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
  if (!isAllowedWebSocketOrigin(origin)) {
    console.warn(`[WebSocket] Origin rejected: ${origin}`);
    return new Response("Forbidden", { status: 403 });
  }
  if (server.upgrade(request, { data: undefined })) return undefined;
  return new Response("WebSocket upgrade failed", { status: 400 });
}

export function isAllowedWebSocketOrigin(origin: string | null): boolean {
  // Native clients (including the Plasma widget) do not send an Origin header.
  if (origin === null) return true;

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch (_) {
    return false;
  }

  return (
    (parsed.protocol === "http:" || parsed.protocol === "https:") &&
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.pathname === "/" &&
    parsed.search === "" &&
    parsed.hash === "" &&
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
