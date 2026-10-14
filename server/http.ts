import path from "node:path";

const LOCALHOST_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

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
