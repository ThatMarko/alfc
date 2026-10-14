# Contributing to ALFC

ALFC changes hardware state with elevated privileges. Describe the behavior you
changed, how you verified it, and which physical platforms remain untested.
Use [the issue templates](https://github.com/ThatMarko/alfc/issues/new/choose)
for reproducible bugs and feature requests. An issue is useful context, not a
prerequisite for a focused fix. Report vulnerabilities through [SECURITY.md](SECURITY.md)
and follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Toolchain and development

The checked toolchain is Bun 1.4.3 and one Node.js 24.11 or newer within major 24 installation:

| Runtime        | Current uses                                                                                |
| -------------- | ------------------------------------------------------------------------------------------- |
| Bun 1.4.3      | Dependency installation, workspace scripts, backend, native FFI/workers, server compilation |
| Node.js 24.11+ | Vite, Vitest, ESLint, TypeScript, Playwright, Husky, and lint-staged CLIs                   |

`bun run` and `bunx` honor a CLI's `#!/usr/bin/env node` shebang unless explicitly
forced to use Bun with `--bun`; invoking them through Bun does not switch every
tool's JavaScript runtime. See the [versioned Bun documentation](https://github.com/oven-sh/bun/blob/bun-v1.4.3/docs/runtime/index.mdx#L134-L147).
Node 26 was an alternative allowed by dependency engine ranges, not an additional
requirement. ALFC declares Node 24 to match its Linux/Windows CI and release jobs.

The Babel 8 transform requires Node 24.11 or newer within major 24. React 19
and Vite 8 are used by the frontend; Vite's default browser target is
`baseline-widely-available` (Chrome/Edge 111, Firefox 114, Safari 16.4).
ESLint 10 uses the maintained `@eslint-react` plugin and React's official Hooks
rules. TypeScript is pinned to 6.0.3 because typescript-eslint 8.71.2 supports
compilers below 6.1; TypeScript 7's native compiler is not yet supported by this
parser. Recheck that constraint before changing the compiler pin, and do not
force incompatible peer dependencies.

This is a development/build requirement. Packaged executables embed Bun and need
neither a separate Node installation nor a separate Bun installation.

Forcing the current test suite onto Bun fails because its fixture setup replaces
the global `Bun` object, which is read-only in the actual Bun runtime. Some Vitest
tests can run under Bun; removing Node requires a deliberate mock-boundary and
tool-launch migration with the same Windows/Linux coverage, not just `--bun`.

The Debian/Ubuntu Hoplite setup retains `apt-get update` and installation of
Git LFS before the frozen dependency install. That provisioning step needs
privileged APT access and an image with the Bun/Node versions above. Git LFS is
a development utility; current tracked binaries are ordinary Git objects.
Browser, Qt, and native compiler test prerequisites remain documented separately.

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

- Qt Quick tests execute widget connection, protocol, URLs, and editor behavior.
  Missing Plasma/Kirigami editor modules produce explicit skips in Qt-only CI.
- Native C++ output packing tests run without Windows. CI also compiles the
  actual WMI DLL with MSVC on Windows.
- .NET export tests use a controlled SDK fixture. They do not establish that
  the legacy Intel SDK can be published or executed through NativeAOT.
- Real Bun subprocess tests exercise loopback networking and entrypoint cleanup
  with hardware replaced by fixtures.

Husky runs lint-staged before commits: ESLint on staged JS/TS, workspace type
checks for TS changes, and Prettier on staged JSON/CSS/Markdown. QML library JS
uses Qt syntax and is checked by the Qt runner instead of ESLint.

## Source map and conventions

| Area                          | Location                                                   | Contract                                               |
| ----------------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| Shared catalog and validation | `common/`                                                  | Canonical method names, IDs, widths, protocol guards   |
| Native hardware               | `server/native/`                                           | Async ordered platform calls; Windows worker ownership |
| Fan controller                | `server/fan-control/`                                      | Paired fan writes, ramping, telemetry, restoration     |
| State and commands            | `server/state/`, `server/websocket/`                       | Serialized mutations, persistence, correlated replies  |
| HTTP and lifecycle            | `server/index.ts`, `server/http.ts`, `server/listeners.ts` | Loopback-only serving and bounded shutdown             |
| React UI                      | `frontend/`                                                | Backend snapshots, request IDs, per-field drafts       |
| Plasma widget                 | `plasmoid/`                                                | QML/JS client with the same validated primary controls |
| Deployment                    | `bootstrap/`, `aur/`, `.github/workflows/`                 | Service management and artifact contents               |

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

Work from the intended branch; PR #1 is `feat/wmi-ffi`. New unrelated changes
normally start from the appropriate target branch. Keep commits focused and
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
