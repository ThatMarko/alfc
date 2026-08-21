# Bun and Plasma Port: Repository Review

This is a review of the current repository as a whole at main commit `72c6160`
(`chore: validate WMI FFI on Bun 1.4`), including the porting history since the
older local baseline `5bd77bb`. It is not merely a review of the small
documentation branch on top of main.

The separately supplied review dated 2026-08-21 describes a different or older
state: it says main uses Bun 1.3.9 and a Windows WMI helper process, while
`72c6160` already uses Bun 1.4.0 and `WmiDll.dll`. That report is useful historical
context, but it is not the Git baseline for this repository-wide assessment.

## Executive assessment

The port at `72c6160` is feature-complete enough for release-candidate testing,
but the supplied evidence does not establish that it is hardware-validated
enough for a release. The in-process C++ COM DLL loaded through `bun:ffi`, the
10-second fan-control cadence, and the relaxed Plasma timers are already part of
main. They are current release risks to validate, not changes introduced by this
review branch.

## Review scope

The review covered the Bun version and workspace configuration, Linux and Windows
release workflows, service shutdown path, fan-control loop, platform abstraction,
Windows C++/FFI boundary, WebSocket server and client boundaries, Plasma backend
connection, packaging, and the existing automated tests. The review branch itself
only corrects the root workspace scripts and adds this assessment.

## Differences between actual main and the supplied external baseline

| Area                | Supplied external baseline              | Actual main at `72c6160`                                        | Planning consequence                                                                                                   |
| ------------------- | --------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Bun                 | 1.3.9 in package metadata and workflows | 1.4.0 in package metadata and workflows                         | Validate with Bun 1.4.0; this is already a main requirement, not a branch upgrade.                                     |
| Windows WMI         | Helper process                          | `WmiDll.dll` through `bun:ffi`                                  | Existing helper-process results do not validate current main, but the transport is not a change in this review branch. |
| Windows native CI   | Helper build requested as a next step   | MSVC build job for `WmiDll.dll` already exists                  | Native compilation coverage exists; hardware-independent runtime-contract tests are still missing.                     |
| Plasma timers       | Bounded reconnect and watchdog          | 30-second reconnect cap, 20-second ping, and 60-second watchdog | Validate disconnect detection and recovery; the timer values are already on main.                                      |
| Fan-control cadence | Not identified as a port delta          | 10-second decision cycle with running-sum averaging             | Recheck thermal response under sudden CPU/GPU load as a current-main release gate, not as a branch regression.         |

## Findings

### P1: No automated evidence for safe native fan restoration

The shutdown implementation stops fan timers and attempts to restore automatic
BIOS control before native cleanup, which is the right order. However, the test
suite mocks native calls and does not exercise service stop, forced termination,
logoff, reboot, or shutdown on hardware. Because a failure can leave fixed fan
mode active, Windows and Linux hardware restoration tests remain release blockers.

### P1: The slower control loop needs thermal-response evidence

Main waits for the interval before starting a temperature collection pass, and
the collection itself samples over most of the 10-second cycle. Consequently, the
first curve-based adjustment after startup can occur substantially later than ten
seconds, and slow native calls can extend that delay. This is not proven unsafe,
but it is safety-relevant and should be measured under step CPU/GPU loads before
release.

### P2: Windows CI compiles but does not execute the native boundary

The Windows job proves that `WmiDll.cpp` compiles with MSVC. It does not load the
DLL from Bun, verify the exported ABI, exercise failed initialization, or check
repeated initialization and cleanup. A calling-convention, symbol, path, or
lifecycle regression can therefore pass CI.

### P2: Windows WMI DLL loading is an eager, unrecoverable startup dependency

The Windows adapter calls `dlopen` when the module is imported, before
`initNativeServices` can apply its retry and availability handling. A missing,
incompatible, or misplaced DLL therefore fails module evaluation rather than
producing the intended “fan control unavailable” state. Either make loading lazy
and report the failure through initialization, or add a packaged-executable smoke
test that makes this failure mode impossible in published artifacts.

### P2: Unsupported platforms fall through to Windows native modules

The native abstraction distinguishes Linux from “not Linux”; every other platform
imports the Windows WMI and CPU-tuning modules. The product currently targets only
Linux and Windows, but an explicit `win32` check with an unsupported-platform
error would make the platform boundary match that contract and prevent confusing
DLL errors on macOS or other Bun platforms.

### P2: Plasma recovery is specified but not automatically exercised

The Plasma backend has bounded reconnect, ping/pong handling, and configurable
endpoint behavior, but there is no automated or recorded compatibility matrix for
the oldest and newest supported Plasma 6 versions. Disconnects longer than the
watchdog, malformed messages, non-default ports, and remote endpoints need manual
validation at minimum.

### P3: Legacy WMI helper sources remain beside the active DLL implementation

The release workflow packages `WmiDll.dll`, while the old `wmiapi` project is still
in the tree. Keeping both implementations without a clear archival marker makes
it easier for documentation or future build changes to select the wrong one.
Remove the unused helper sources or label them explicitly as historical and
non-shipping.

### Confirmed strengths

- Bun is consistently pinned to 1.4.0 in package metadata, CI, and release jobs.
- CI installs from the frozen lockfile and runs the combined quality command.
- Linux and Windows release assembly use platform-specific native artifacts.
- Shutdown stops fan-control timers before attempting BIOS restoration.
- WebSocket messages and browser origins are validated at the server boundary.
- Plasma uses Qt WebSockets, bounded reconnects, a watchdog, i18n, and accessible
  controls rather than embedding the web UI.
- The configured Plasma backend endpoint is also used to derive the Web UI URL.

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
behavior. Results collected for the older helper-process implementation are not
transferable to current main.

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

The workspace-script correction is suitable to merge independently. Do not cut a
release from current main until the direct WMI DLL contract and the slower
fan-control cadence have explicit evidence; they are current-main validation
gaps that the supplied external review does not cover.
