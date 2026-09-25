# Bun and Plasma port review

This review records the repository-wide validation performed on 2026-08-21 so
that future upgrades have a reproducible baseline.

## Current baseline

- Bun is pinned to 1.3.9 in `packageManager`, CI, and both release jobs. The
  declared engine floor is the same version.
- Dependency updates stay within the currently declared major versions. This
  keeps the review focused: React 19, ESLint 10, Vitest 4, and other major
  upgrades should be handled separately with their own migration testing.
- `bun install --frozen-lockfile` followed by `bun run all-checks` is the
  supported clean-install validation path.
- Workspace scripts use explicit `frontend` and `server` filters. Do not replace
  these with a root `--workspaces` invocation: because the root script has the
  same name, that form can recursively invoke itself instead of reaching the
  packages.

## Review findings

### Bun backend

- The compiled executable resolves production assets relative to
  `process.execPath`, while development continues to use the source directory.
- Shutdown stops fan-control timers before restoring BIOS automatic control.
- The WebSocket boundary validates message kinds and required payloads, rejects
  non-local browser origins, and returns protocol errors without exposing
  internal exception details.
- Linux and Windows native implementations remain behind the platform
  abstraction. Windows WMI runs in a helper process, while CPU overclocking is
  an optional NativeAOT library.

### Plasma widget

- The widget uses Qt WebSockets rather than embedding the web application.
- Backend reconnects use bounded exponential backoff and a ping/pong watchdog.
- The configured backend URL is also the source for the Web UI URL, so remote
  or non-default endpoints are not silently replaced with localhost.
- User-visible QML strings use KDE's `i18n()` integration and interactive
  controls expose accessibility metadata.

### Packaging and service lifecycle

- Linux artifacts include systemd/OpenRC scripts and the Plasma package.
- Windows artifacts include the .NET Framework WMI helper and WinSW wrapper;
  optional CPU tuning binaries are intentionally not distributed.
- CI uses a frozen lockfile, least-privilege token permissions, and one complete
  lint/type-check/test/build command.

## Next steps

1. Run a Windows hardware soak test that repeatedly switches fixed/automatic
   modes, exercises GPU boost, and confirms automatic BIOS fan control after
   service stop, logoff, and shutdown.
2. Run a Linux hardware soak test on both systemd and OpenRC, including a lost
   `acpi_call` module and service restart while the frontend is connected.
3. Validate the Plasma package with `kpackagetool6` and `plasmoidviewer` on the
   oldest supported Plasma 6 release and the latest release before publishing.
4. Treat each remaining major dependency update as a separate change. Start
   with Vitest/Vite, then ESLint, and leave React for last so failures have a
   narrow cause.
5. Add Windows CI coverage for the WMI helper build and a protocol-level helper
   test that does not require Aorus hardware.

Hardware validation is still required before a release: automated tests mock
native calls and cannot prove ACPI/WMI behavior or safe fan restoration on a
real laptop.
