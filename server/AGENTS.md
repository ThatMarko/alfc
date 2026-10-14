# Server package

## Responsibilities and entry points

The Bun backend owns hardware access, validated configuration, state persistence,
fan telemetry, and production HTTP/WebSocket serving. `index.ts` requires root on
Linux or an enabled Administrators SID in the effective Windows token. Windows
permission checks use Advapi32 directly and do not require the LanmanServer service.

| Area                               | Implementation and checks                                                 |
| ---------------------------------- | ------------------------------------------------------------------------- |
| Startup, signal handling, shutdown | `index.ts`, `listeners.integration.test.ts`                               |
| Loopback listeners                 | `listeners.ts`: required IPv4 `127.0.0.1`, optional IPv6 `::1`, port 5522 |
| HTTP origin and asset boundaries   | `http.ts`, `http.test.ts`                                                 |
| Effective process privileges       | `permissions.ts`, `permissions.test.ts`                                   |
| Automatic/fixed fan modes          | `fan-control/index.ts` and colocated tests                                |
| Native platform boundaries         | `native/index.ts`; read `native/AGENTS.md` before editing adapters        |
| Atomic configuration writes        | `state/index.ts` and colocated tests                                      |
| Shared protocol and validation     | `../common/types.ts`, `../common/methods.ts`, `../common/PROTOCOL.md`     |
| WebSocket state/activity fan-out   | `websocket/index.ts` and colocated tests                                  |
| Compilation                        | `build.ts`: Linux x64/arm64, Windows x64 only                             |

## Runtime contracts

- Both loopback listeners share one mutation queue and publish the same confirmed
  state and telemetry. Never bind a privileged control endpoint to a wildcard.
- IPv6 absence permits IPv4 fallback only for `EAFNOSUPPORT`, `EADDRNOTAVAIL`, or
  `ENODEV`. An occupied IPv6 port fails startup and closes the owned IPv4 listener.
- Browser WebSocket Origins must be HTTP(S) loopback origins. Native clients,
  including QtWebSockets, may omit Origin. Origin checking is not user authentication.
- Only GET upgrades `/ws`; static files accept GET/HEAD. Decode asset URLs before
  containment checks and reject encoded Windows separators on every platform.
- WebSocket input is limited to 64 KiB; output backpressure is bounded to 1 MiB
  with connection closure. Keep shared validation and client error handling aligned.
- Register shutdown handlers before native initialization. Stop new work, clear
  publisher registrations, close every listener, drain admitted work, and attempt
  both BIOS restore writes even after errors. The budgets are 5 seconds to drain,
  5 seconds to restore, and 2 seconds to clean up; wrappers allow at least 15 seconds.
- A failed capability probe does not prove firmware was untouched. Retain the fan
  restore-required flag until a successful handoff. Never unload a NativeAOT DLL.

## Development and validation

Use Bun 1.4.3 or newer and Node 24 for the repository's current Vitest toolchain.
`bun run --cwd server start` watches the backend; the frontend dev server runs
separately on port 3000. `bun run build` compiles the packages. A production
executable needs `frontend/` and `alfc.config.json` alongside it; use the assembled
release from the root build scripts rather than assuming `server/dist` is complete.
For uncompiled source with `NODE_ENV=production`, assets come from
`frontend/build`, configuration remains in the checkout, and native adapters use
their source locations. `isCompiledBinary` selects filesystem/worker paths;
`isDev` selects development behavior. Never use `NODE_ENV` to infer compilation.
Run packaged production builds with their `run.sh`/`run.bat`, or run source with
`NODE_ENV=production bun server/index.ts` after building the frontend. These are the supported production entry points.

Run root `bun run all-checks`. The listener integration suite launches real Bun
subprocesses and sockets with hardware fixtures; it covers IPv4/IPv6 mutation and
telemetry parity, partial bind rollback, and synchronous listener-stop failures.
Keep tests colocated, avoid `any`, and use `node:` prefixes for Node built-ins.
Hardware tests require a supported machine; a green mocked suite is not firmware
or Windows SDK compatibility evidence.
