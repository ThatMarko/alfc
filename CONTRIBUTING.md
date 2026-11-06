# Contributing to ALFC

ALFC changes hardware state with elevated privileges. Describe the behavior you
changed, how you verified it, and which physical platforms remain untested.
The fork’s issue tracker was disabled when checked on 2026-10-15. Submit a
focused pull request for a concrete fix; if issues are enabled later, use
[the issue templates](https://github.com/ThatMarko/alfc/issues/new/choose) for
reproducible bugs and feature requests. An issue is not a prerequisite for a fix. Report vulnerabilities through [SECURITY.md](SECURITY.md)
and follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Toolchain and development

The tested toolchain is Bun 1.4.4 and Node.js 24.22.0 LTS. Node 24.11 remains
the minimum supported patch within major 24; testing a newer patch does not
raise that minimum:

| Runtime                         | Current uses                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| Bun 1.4.4                       | Dependency installation, workspace scripts, backend, native FFI/workers, server compilation |
| Node.js 24.22.0 (minimum 24.11) | Vite, Vitest, ESLint, TypeScript, Playwright, Husky, and lint-staged CLIs                   |

`bun run` and `bunx` honor a CLI's `#!/usr/bin/env node` shebang unless explicitly
forced to use Bun with `--bun`; invoking them through Bun does not switch every
tool's JavaScript runtime. See the [versioned Bun documentation](https://github.com/oven-sh/bun/blob/bun-v1.4.4/docs/runtime/index.mdx#L134-L147).
The official [Node release index](https://nodejs.org/dist/index.json), rechecked
on 2026-10-15, lists 24.22.0 as Krypton LTS and 26.12.0 as Current. ALFC
declares major 24 and pins the tested patch in Linux/Windows CI and release jobs.

The Babel 8 transform requires Node 24.11 or newer within major 24. React 19
and Vite 8 are used by the frontend; Vite's default browser target is
`baseline-widely-available` (Chrome/Edge 111, Firefox 114, Safari 16.4).
ESLint 10 uses the maintained `@eslint-react` plugin and React's official Hooks
rules. TypeScript is pinned to 6.0.3 because typescript-eslint 8.71.2 supports
compilers below 6.1; TypeScript 7's native compiler is not yet supported by this
parser. Recheck that constraint before changing the compiler pin, and do not
force incompatible peer dependencies.

The root `overrides` entry raises the lint-only transitive `minimatch`
dependency to `^11.0.1`, the first release fixing
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).
ESLint 10.14, `@eslint/config-array` 0.23.5 and `typescript-eslint` 8.72 still
declare `^10`, and no fixed 10.x release exists. They use only
`Minimatch#match`, `pattern`, and the `dot`/`flipNegate` options, which 11.x
keeps. Remove the override once those packages accept 11.x.

This is a development/build requirement. Packaged executables embed Bun and need
neither a separate Node installation nor a separate Bun installation.

Forcing the current test suite onto Bun fails because its fixture setup replaces
the global `Bun` object, which is read-only in the actual Bun runtime. Some Vitest
tests can run under Bun; removing Node requires a deliberate mock-boundary and
tool-launch migration with the same Windows/Linux coverage, not just `--bun`.

Cloud setup must activate Bun 1.4.4 and Node 24.22.0 in every setup, run and
check shell, or use an image containing those versions. The tracked Hoplite
configuration preserves privileged APT/Git LFS provisioning, then runs
`sh tools/check-cloud-runtime.sh` before the frozen install. This script
validates the exact cloud pins and prints activation guidance; it does not
install runtimes or change the package engine minima. Cloud preview starts
only the normal-user Vite frontend. Start the backend separately with elevation
on an appropriate hardware host. Current tracked binaries are ordinary Git
objects; Git LFS is a development utility. Browser, matching Qt/KDE components,
and native compiler prerequisites remain separate from the JavaScript install.

```bash
bun install --frozen-lockfile
bun run --cwd frontend start
```

Start the backend separately in an elevated terminal:

```bash
# Linux; use the same command without sudo in a Windows administrator terminal.
sudo bun run --cwd server start
```

Vite serves port 3000; the backend listens only on loopback port 5522.
`bun run start` launches both workspaces together and requires elevation for
the combined command. The backend exits when elevation is missing. Do not run
real hardware entrypoints as a normal user to bypass that requirement; use
isolated mocks for tests. Development loads `alfc.config.json` from the repo
and deliberately skips persistence. Packaged production uses the file beside
the executable and serves the packaged frontend.

## Checks

```bash
bun run all-checks       # ESLint, strict TypeScript, Vitest, workspace builds
bunx playwright install chromium
bun run test:web        # Chromium protocol and layout scenarios
bun run test:integration # Built web UI + real QML client + production handlers/fake hardware
bun run check:docs      # Local Markdown paths and heading anchors
bun outdated --recursive # Available updates across all workspaces
bun audit               # Current advisory data; network required
bun run del:tscache     # Remove only this workspace's known compiler caches
```

The lockfile is committed. Use a normal `bun install` only when intentionally
changing dependencies, then review the manifest and lockfile diff and repeat
a frozen install. Do not suppress advisories or change version pins merely to
obtain a passing report. Audit findings depend on current registry data.

Browser tests launch Vite and provide controlled WebSocket scenarios. They are
not physical firmware tests. They use an installed `/usr/bin/chromium` outside
CI, or a Playwright browser; `ALFC_CHROMIUM_EXECUTABLE` selects another binary.
Avoid an unrelated server on port 3000 when running them.

Additional checks, with prerequisites and limits, are in
[PORTING_REVIEW.md](PORTING_REVIEW.md):

- Qt-only tests execute connection, protocol and URL behavior; missing
  Plasma/Kirigami produces explicit optional skips only in that tier.
  `bash plasmoid/run_component_tests.sh` uses matching distro Qt/KDE libraries
  and fails when required imports or components are broken. See
  [the tier dependencies](plasmoid/DEPENDENCIES.md#development-checks).
- The cross-client integration requires built frontend assets, Chromium,
  PySide6 6.12.0 and free port 5522 on both loopback families. Set
  `ALFC_QT_PYTHON` to a separate Qt virtual environment’s interpreter. It runs
  production handlers and real web/QML clients with explicit fake native
  adapters in a disposable source tree; no elevation or real hardware is used.
- Native C++ output packing tests run without Windows. CI also compiles the
  actual WMI DLL with MSVC on Windows.
- .NET export tests use a controlled SDK fixture. They do not establish that
  the legacy Intel SDK can be published or executed through NativeAOT.
- Real Bun subprocess tests exercise loopback networking and entrypoint cleanup
  with hardware replaced by fixtures.
- `python3 plasmoid/test_install.py` and `python3 omarchy/test_install.py` run
  the shipped per-user helpers in disposable directories. Service and AUR
  lifecycle regressions run with Vitest against isolated manager adapters;
  they never install or remove a host service.

Husky runs lint-staged before commits: ESLint on staged JS/TS, workspace type
checks for TS changes, and Prettier on staged JSON/CSS/Markdown. QML library JS
uses Qt syntax and is checked by the Qt runner instead of ESLint.

## Source map and conventions

Start with [ARCHITECTURE.md](ARCHITECTURE.md): it shows how the backend,
clients and native layers cooperate and traces one setting from a client
through validation, the ordered queue, hardware, persistence and the reply.

| Area                          | Location                                                   | Contract                                               |
| ----------------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| Shared catalog and validation | `common/`                                                  | Canonical method names, IDs, widths, protocol guards   |
| Native hardware               | `server/native/`                                           | Async ordered platform calls; Windows worker ownership |
| Fan controller                | `server/fan-control/`                                      | Paired fan writes, ramping, telemetry, restoration     |
| State and commands            | `server/state/`, `server/websocket/`                       | Serialized mutations, persistence, correlated replies  |
| HTTP and lifecycle            | `server/index.ts`, `server/http.ts`, `server/listeners.ts` | Loopback-only serving and bounded shutdown             |
| React UI                      | `frontend/`                                                | Backend snapshots, request IDs, per-field drafts       |
| Plasma widget                 | `plasmoid/`                                                | QML/JS client with the same validated primary controls |
| Omarchy module                | `omarchy/`                                                 | Read-only QML status/launcher and per-user installer   |
| Cross-client tests            | `integration/`                                             | Production handlers with explicit fake Linux hardware  |
| Deployment                    | `bootstrap/`, `aur/`, `.github/workflows/`                 | Service management and artifact contents               |
| Documentation tooling         | `tools/check_docs.py`                                      | Local Markdown links and anchors, source or staged     |

Read the nested notes before editing those areas: `server/AGENTS.md`,
`server/native/AGENTS.md` and `bootstrap/AGENTS.md`.

### Where common changes go

| Change                                   | Files to touch                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A validation limit for a setting         | `common/validation.ts` (config loading, fan-table requests and snapshot guards), the range checks in `server/websocket/index.ts`, `plasmoid/package/contents/ui/Protocol.js`, the web editors in `frontend/src/utils/`, the widget editors, `common/PROTOCOL.md`, and [OPERATIONS.md](OPERATIONS.md#configuration) |
| A new saved setting                      | `common/types.ts`, `server/state/index.ts` (defaults and load check), `alfc.config.json`, a handler in `server/websocket/index.ts`, both clients, and both protocol documents                                                                                                                                      |
| A new message kind or reply field        | `common/types.ts`, `common/protocol.ts`, `plasmoid/package/contents/ui/Protocol.js`, `server/websocket/index.ts`, `common/PROTOCOL.md`, `common/COMPATIBILITY.md`                                                                                                                                                  |
| Fan curve, ramping or telemetry behavior | `server/fan-control/index.ts` and its tests                                                                                                                                                                                                                                                                        |
| A firmware method                        | `common/methods.ts` (canonical catalog), then the caller; never hand-write IDs or argument orders                                                                                                                                                                                                                  |
| Linux or Windows hardware transport      | `server/native/linux/` or `server/native/windows/`, through `server/native/index.ts`                                                                                                                                                                                                                               |
| Web dashboard UI                         | `frontend/src/containers/` and `frontend/src/components/`; connection logic in `frontend/src/utils/`                                                                                                                                                                                                               |
| Plasma widget UI                         | `plasmoid/package/contents/ui/`; tests beside `plasmoid/run_qml_tests.py`                                                                                                                                                                                                                                          |
| Service install/remove behavior          | `bootstrap/scripts/`, with regressions in `bootstrap/*.test.ts`; Arch packaging in `aur/`                                                                                                                                                                                                                          |
| Release contents                         | `build.sh`, `build.bat`, `.github/workflows/release.yml` and `aur/PKGBUILD` together; see [RELEASING.md](RELEASING.md)                                                                                                                                                                                             |

Root-level, `common/` and `plasmoid/` Markdown files are copied into both
release archives and the Arch package documentation automatically; from
`aur/` only `README.md` is copied, and other directories (such as a new
`docs/`) are not copied at all. Link to source code with code spans or absolute
GitHub URLs, because staged documentation roots do not contain the source
tree. Check a staged root with `python3 tools/check_docs.py PATH`.

### Safe hardware-free testing

Never start the real backend without elevation and never weaken
`server/permissions.ts` for a test. Tests replace the hardware boundary
instead: Vitest mocks `server/native/`, the listener suites run real Bun
subprocesses with hardware fixtures, and `integration/protocol-fixture.ts`
substitutes only Linux's ACPI and CPU adapters. Service-script tests redirect
every privileged path and service command into temporary directories. Do not
run `install.sh`, `install.bat` or the AUR package on your development
machine to test a change. The table in
[ARCHITECTURE.md](ARCHITECTURE.md#testing-without-hardware) lists what each
tier can and cannot show.

Use extensionless relative ESM imports and `node:` for built-ins. TypeScript
uses `strict` and `noUncheckedIndexedAccess`; explicit `any` is an ESLint error.
Unused parameters may use an underscore prefix. Give interactive controls an
accessible name and keep authored QML UI text translatable through `i18n()`.
Colocate tests with the code. Use Bun scripts rather than Makefiles or Docker.

Respect [AGENTS.md](AGENTS.md) and the applicable nested agent instructions.
Do not move blocking Windows FFI onto the main thread, unload a NativeAOT
library, bypass managed fan setters through raw commands, or replay a hardware
write queued during disconnection. Hardware acceptance, saved configuration,
and telemetry-confirmed output are separate facts.

## Pull requests

Discover the remote default branch (`master` at the merged PR #1 baseline),
fetch it, inspect the working tree, and base follow-up changes on its current
revision. Do not rename it to match the colloquial name “main.” Preserve user
changes and use a review branch when required by protections or review practice;
do not force-push, merge automatically, or publish releases as routine maintenance. Keep commits focused and
use conventional messages such as `fix(windows): ...` or `docs: ...`.

Include the problem, resulting behavior, actual checks, and limitations. Changes
to the protocol must update both [PROTOCOL.md](common/PROTOCOL.md) and
[COMPATIBILITY.md](common/COMPATIBILITY.md), including client version needs.
Current web/widget commands require protocol 1.1 request correlation; the
server still accepts legacy requests without a request ID.

For native or fan-control changes, report the exact laptop, OS, firmware, and
driver used, if any. Test failed writes, partial initialization, backend restart,
and service stop/BIOS handoff. A complete Plasma shell session is also needed
for desktop integration claims. If hardware is unavailable, say so explicitly;
passing mock, browser, or headless Qt tests does not certify a laptop.
