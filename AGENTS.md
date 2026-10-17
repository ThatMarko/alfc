# ALFC contributor instructions

These instructions describe the merged mainline implementation on `master`.
PR #1 merged as `79791f67b7c544b9a9f61e168a88bce5f22fc085`. Discover the
remote default branch and current revision before starting; use applicable nested
`AGENTS.md` files and preserve unrelated user work. Base follow-up work on the
current default branch and respect its protections and review process.

## Repository map

| Location                                | Responsibility                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------- |
| `common/`                               | Types, validation, protocol guards, canonical MOF method catalog, protocol docs       |
| `frontend/`                             | React/Vite UI, backend request manager, Vitest and Chromium scenarios                 |
| `server/index.ts`                       | Permission gate, HTTP/WS handlers, startup, bounded shutdown                          |
| `server/http.ts`, `server/listeners.ts` | Static path/origin validation and explicit loopback listeners                         |
| `server/fan-control/`                   | Paired writes, threshold curves, ramping, sampling, BIOS restoration                  |
| `server/native/`                        | Ordered platform calls; Linux ACPI/RAPL and Windows FFI workers                       |
| `server/state/`, `server/websocket/`    | Validated configuration, ordered persistence, command handling                        |
| `plasmoid/`                             | Plasma 6 QML/JS widget, installation, Qt-only and required matching-component tests   |
| `omarchy/`                              | Unprivileged read-only Omarchy QML status/launcher and owned user-module installation |
| `integration/`                          | Production-handler web/QML cross-client tests with explicit fake hardware             |
| `bootstrap/`, `aur/`                    | Windows WinSW and Linux service/package integration                                   |
| `.github/workflows/`                    | CI and tag-driven release packaging                                                   |
| `PORTING_REVIEW.md`                     | Audit evidence, authoritative sources, and physical release gates                     |

## Toolchain and commands

Use Bun 1.4.3 (the package-manager and workflow pin) and Node.js 24.11 or newer within major 24 for the
checked development tools. Node 24.22.0 is the recommended and CI-tested LTS
patch; 24.11 remains the minimum. Node 26 is Current, not the supported LTS major. `bun run`/`bunx` preserve Node shebangs for CLIs such as Vite, Vitest, ESLint,
TypeScript, Playwright, Husky, and lint-staged. Packaged production embeds Bun and
requires neither a separate Node nor Bun installation. TypeScript stays pinned to 6.0.3 while the ESLint parser requires <6.1.
A Bun-only test migration
must first replace whole-global `Bun` mocks; forcing the current suite fails setup.

```bash
bun install --frozen-lockfile
bun run all-checks        # lint, strict type-check, Vitest, workspace builds
bun run test:web          # Chromium scenarios; install browser first if needed
bun run test:integration  # Built web assets + real QML connection; see CONTRIBUTING
bun run check:docs        # Local Markdown paths and anchors
bun audit                # Live registry advisory check, no automatic suppression
bun run del:tscache       # Only the known workspace .tsbuildinfo files
```

Run `bun run --cwd frontend start` as a normal user. Run
`sudo bun run --cwd server start` on Linux, or the server command in an
administrator terminal on Windows. Vite uses port 3000; the backend uses
loopback port 5522. The root `start` script launches both workspaces together
and requires elevation for that combined command.

Never run the real backend without elevation. Hardware-free fixture tests must
replace the hardware boundary rather than weaken the production permission gate.
Do not run service installers against the development host for routine tests.

## Implementation contracts

- Bun owns installation, workspaces, builds, HTTP/WebSocket serving, workers,
  and FFI. Use documented Bun APIs where appropriate; `node:` built-ins remain
  appropriate for portable filesystem and path operations.
- Use extensionless relative ESM imports. TypeScript is strict with
  `noUncheckedIndexedAccess`; handle missing indexed values. Explicit `any` is
  an ESLint error; unused variables/parameters may use an underscore prefix.
- Blocking Windows FFI stays in its owning worker. WMI and optional CPU tuning
  use separate workers/queues. COM initialization, calls, and cleanup stay on
  one WMI thread. Compiled Windows builds include the worker entrypoint.
- A NativeAOT DLL cannot be explicitly unloaded. The optional CPUOC prototype
  is not a verified deployment of the bundled legacy managed Intel SDK; do not
  describe a successful mock/export test as actual XTU support.
- Method ID, name, argument names/order, integer widths, and output widths
  come from the shared MOF catalog. Exact packed outputs above JavaScript's
  safe integer range are decimal strings. Raw managed fan setters are blocked.
- Await and serialize both fan writes. `appliedSpeed: null` means unconfirmed
  output, and recovery must not depend on successful temperature reads in
  fixed mode. Both BIOS restoration commands must be attempted on shutdown.
- Clients follow validated backend snapshots and their own request IDs.
  Current clients require protocol 1.1 within major 1; legacy requests without
  IDs still work on the current server. The web client retains its last validated
  snapshot across disconnects; only its separate connection-readiness flag may
  authorize writes. Never replay disconnected hardware
  writes or settle a command from another client's response.
- Preserve unrelated drafts, distinguish stale/failed telemetry, and expose
  capability loss/restart guidance without disabling unaffected features. Missing
  initial telemetry becomes stale after ten seconds when monitoring is expected;
  unrelated state updates and pongs must not refresh that deadline.
- Production saves settings only, after ordered mutation handling. Runtime
  capability/restart fields must not be loaded from persisted configuration.
  Development deliberately skips persistence.
- Select resource paths from source versus compiled execution, not merely
  `NODE_ENV`. Bind explicit loopback families, broadcast on each listener,
  and close every owned listener without preventing BIOS cleanup on errors.

## UI, tests, and documentation

Give interactive web/QML controls accessible names; connect explanatory text to
keyboard-accessible controls. Wrap authored QML UI text in `i18n()`; backend
errors and user data are separate from translated UI labels. Check narrow
layouts, focus behavior, stale/error states, and per-feature pending controls.

Colocate meaningful `*.test.ts` tests; browser tests use `*.e2e.ts`, native C++
and C# checks are beside their implementation, and QML tests live beside the
widget runner outside the installable package. Do not create Makefiles or Docker
workflows. Do not replace hardware behavior with trivial passing tests.

Keep all affected Markdown aligned with actual code and workflow artifacts.
Protocol changes update both `common/PROTOCOL.md` and `common/COMPATIBILITY.md`.
Distinguish historical device reports, automated fixture checks, real native
compilation, full Plasma sessions, and physical firmware/driver testing. Cite
current official documentation or installed declarations for unfamiliar APIs;
do not invent performance or safety guarantees.

The pre-commit hook runs ESLint, workspace type checks, and Prettier through
lint-staged. Qt library JS contains `.pragma library` and is validated by Qt,
not ESLint. The required component tier uses one distro’s Qt/KDE libraries;
never mix unrelated wheel Qt with distro plugins. Qt-only optional skips do not
count as component coverage. Full Plasma/Omarchy sessions remain a separate gate.
Builds alone are not complete installable releases; follow
`RELEASING.md` for staging, native libraries, service files, and release gates.
