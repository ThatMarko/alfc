# Bun and Plasma Port: Branch Review

This review evaluates the change on top of repository main commit `72c6160`
(`chore: validate WMI FFI on Bun 1.4`). The separately supplied review dated
2026-08-21 describes a different or older repository state: for example, it says
main uses Bun 1.3.9 and a Windows WMI helper process, while `72c6160` already uses
Bun 1.4.0 and `WmiDll.dll`. It is therefore treated as an external historical
baseline, not as the Git baseline for this change.

## Executive assessment

The port at `72c6160` is feature-complete enough for release-candidate testing,
but the supplied evidence does not establish that it is hardware-validated
enough for a release. The in-process C++ COM DLL loaded through `bun:ffi`, the
10-second fan-control cadence, and the relaxed Plasma timers are already part of
main. They are current release risks to validate, not changes introduced by this
review branch.

## Actual branch diff from main

The only code/configuration change made by this review branch is to replace the
root `--workspaces` script calls with explicit `frontend` and `server` filters.
This preserves the main-branch behavior requested in the supplied review and
prevents a root script from selecting itself when script names overlap.

## Differences between actual main and the supplied external baseline

| Area                | Supplied external baseline              | Actual main at `72c6160`                                        | Planning consequence                                                                                                   |
| ------------------- | --------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Bun                 | 1.3.9 in package metadata and workflows | 1.4.0 in package metadata and workflows                         | Validate with Bun 1.4.0; this is already a main requirement, not a branch upgrade.                                     |
| Windows WMI         | Helper process                          | `WmiDll.dll` through `bun:ffi`                                  | Existing helper-process results do not validate current main, but the transport is not a change in this review branch. |
| Windows native CI   | Helper build requested as a next step   | MSVC build job for `WmiDll.dll` already exists                  | Native compilation coverage exists; hardware-independent runtime-contract tests are still missing.                     |
| Plasma timers       | Bounded reconnect and watchdog          | 30-second reconnect cap, 20-second ping, and 60-second watchdog | Validate disconnect detection and recovery; the timer values are already on main.                                      |
| Fan-control cadence | Not identified as a port delta          | 10-second decision cycle with running-sum averaging             | Recheck thermal response under sudden CPU/GPU load as a current-main release gate, not as a branch regression.         |

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
