const IPV6_UNAVAILABLE_CODES = new Set([
  "EAFNOSUPPORT",
  "EADDRNOTAVAIL",
  "ENODEV",
]);

export async function listenOnLoopback<T>(
  options: Bun.Serve.Options<T> & { unix?: never },
): Promise<Bun.Server<T>[]> {
  // Resolving "localhost" may bind only ::1. Native clients and the web UI
  // can use either address family, so bind each loopback address explicitly.
  const ipv4 = Bun.serve({ ...options, hostname: "127.0.0.1" });
  const servers = [ipv4];
  try {
    servers.push(
      Bun.serve({
        ...options,
        port: ipv4.port,
        hostname: "::1",
        ipv6Only: true,
      }),
    );
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string" &&
      IPV6_UNAVAILABLE_CODES.has(error.code)
    ) {
      console.warn("[Server] IPv6 loopback is unavailable; using IPv4 only.");
      return servers;
    }

    // An occupied IPv6 port may belong to another process. Close our owned
    // listener before failing instead of leaving a partially running service.
    try {
      await ipv4.stop(true);
    } catch (cleanupError) {
      console.error("[Server] Failed to close IPv4 listener:", cleanupError);
    }
    throw error;
  }

  return servers;
}
