# Bun and Plasma Port: Branch Review

This review compares the `work` branch at `72c6160` with the supplied main-branch
review dated 2026-08-21. The local repository has no `main`/`master` reference or
remote, so the supplied review is the source of truth for the current main
baseline. The older local commit `5bd77bb` is useful for history, but it must not
be treated as current main.

## Executive assessment

The port is feature-complete enough for release-candidate testing, but it is not
hardware-validated enough for a release. The Plasma architecture and service
lifecycle are broadly aligned with main. The largest branch-specific change is
the Windows WMI transport: this branch replaced the helper process described in
the main review with an in-process C++ COM DLL loaded through `bun:ffi`.

That replacement may reduce latency, memory use, and process-management failure
modes, but it also invalidates any Windows soak-test evidence collected for the
helper-process implementation. Treat Windows hardware validation as a fresh
release gate.

## Differences from the supplied main baseline

| Area                | Supplied main baseline                   | This branch                                                            | Consequence                                                                                                                |
| ------------------- | ---------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Bun                 | 1.3.9 in package metadata and workflows  | 1.4.0 in package metadata and workflows                                | Run the entire clean-install suite on Bun 1.4.0 and do not merge if the lockfile changes.                                  |
| Workspace scripts   | Explicit `frontend` and `server` filters | Had root `--workspaces` calls                                          | Fixed in this review to avoid recursively invoking a root script with the same name.                                       |
| Windows WMI         | Helper process                           | `WmiDll.dll` through `bun:ffi`                                         | Requires new lifecycle, error-path, repeated-init, and hardware tests.                                                     |
| Windows native CI   | Helper build requested as a next step    | MSVC build job for `WmiDll.dll` already exists                         | The build half is complete; hardware-independent behavior tests are still missing.                                         |
| Plasma timers       | Bounded reconnect and watchdog           | Longer 30-second reconnect cap, 20-second ping, and 60-second watchdog | Validate disconnect detection and recovery on both oldest and newest supported Plasma 6.                                   |
| Fan-control cadence | Not identified as a port delta           | 10-second decision cycle with running-sum averaging                    | Recheck thermal response under sudden CPU/GPU load; this is safety-relevant behavior, not only a performance optimization. |

## Release gates, in order

### 1. Reproduce the software baseline

Use Bun 1.4.0 and run:

```bash
bun install --frozen-lockfile
bun run all-checks
```

The installed Bun version must match `packageManager`, the engine floor, CI, and
both release jobs. A successful run with another Bun version is useful but does
not satisfy this gate.

### 2. Add hardware-independent Windows native tests

Before a soak test, extract or expose a seam that can exercise the TypeScript FFI
adapter without Aorus hardware. At minimum, automate:

- missing DLL and failed `wmi_init` reporting;
- repeated init/cleanup and cleanup after partial initialization;
- propagation and sanitization of `wmi_get`/`wmi_set` failures;
- DLL lookup in development and compiled-executable layouts;
- WebSocket protocol errors generated from native failures.

Keep the existing Windows MSVC build job. Add these tests to the Windows CI job
so compiling the DLL is not mistaken for validating its runtime contract.

### 3. Repeat the Windows hardware soak test

On each supported Windows generation available, repeatedly switch fixed and
automatic modes, exercise GPU boost, and introduce service stop/restart cycles.
Confirm BIOS automatic fan control after normal stop, forced termination,
logoff, reboot, and shutdown. Review both ALFC/WinSW logs and observed fan
behavior. The direct-FFI transport makes results from the helper-process branch
non-transferable.

### 4. Run the Linux service matrix

Test systemd and OpenRC with the frontend and Plasma widget connected. Include
normal restart, missing or unloaded `acpi_call`, malformed ACPI responses, and
restoration of automatic control during shutdown. Verify that reconnecting
clients recover without stale state.

### 5. Validate Plasma compatibility and network recovery

Install and preview the package with `kpackagetool6` and `plasmoidviewer` on the
oldest supported Plasma 6 release and the latest release. In addition to visual
and accessibility checks, interrupt the backend for longer than the watchdog,
restore it, and verify bounded reconnection. Test localhost, a non-default port,
and a configured remote endpoint so the Web UI URL continues to follow the
backend URL.

### 6. Validate thermal response after cadence changes

Record temperature, requested fan target, and observed fan speed under idle,
step-load, and alternating CPU/GPU load. Compare ramp-up latency with the former
cadence. If a 10-second decision interval permits unacceptable temperature
overshoot, address adaptive polling before release rather than treating it as a
future performance feature.

### 7. Defer unrelated major upgrades

Do not combine this port with React, ESLint, Vite, or Vitest major-version
migrations. Once the release gates pass, upgrade Vite/Vitest first, ESLint
second, and React last, with a clean validation run for each change.

## Merge recommendation

Do not merge for release yet. The branch is ready for CI and test-harness work,
followed by Windows, Linux, and Plasma soak testing. Merge only after the direct
WMI DLL contract and the slower fan-control cadence have explicit evidence; they
are the two material risks not covered by the supplied main-branch review.
