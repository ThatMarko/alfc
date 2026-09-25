# ALFC Roadmap

> Living document tracking planned work, nice-to-haves, and areas where contributions are welcome.
> Updated as priorities shift — check the [issues](https://github.com/ThatMarko/alfc/issues) for the latest discussion.

---

## Current State (v2.0.0)

What ships in v2.0.0:

- **bun:ffi WMI bindings** — replaced the .NET Framework 4.8 helper process (`WmiAPI.exe`) with a C++ DLL (`WmiDll.dll`) loaded directly via `bun:ffi`. ~100,000x less call overhead, ~50-120 MB less memory, fewer failure modes.
- **Performance-optimized fan control** — 10-second decision cycle (up from 1s), running-sum temperature averaging (zero per-cycle allocations), GC-safe FFI pointer caching, BSTR method name cache in the DLL.
- **Relaxed WebSocket timers** — plasmoid keepalive 5s to 20s, pong watchdog 15s to 60s, reconnect backoff cap 5s to 30s, server idle timeout 30s to 120s. Fewer CPU wakeups across the stack.
- **KDE Plasma 6 widget** — panel, system tray, desktop widget modes with context-aware UI, rich tooltip, fan curve editor, accessibility annotations.
- **CI/CD pipeline** — GitHub Actions builds Linux + Windows executables and plasmoid package on version tags.
- **Service hardening** — WinSW `stopParentFirst` + `stopTimeout`, systemd security directives, exit handler restores BIOS fan control.

### How ALFC compares (polling intervals)

| Software              | Sensor Polling | ALFC |
| --------------------- | -------------- | ---- |
| NBFC                  | 3s             | 10s  |
| Thinkfan              | 5s (2s spikes) | 10s  |
| FanControl (Rem0o)    | 1s             | 10s  |
| lm-sensors/fancontrol | 10s            | 10s  |
| Corsair iCUE          | < 1s           | 10s  |
| NZXT CAM              | < 1s           | 10s  |

---

## TODO

### Ship & Distribute

> Get v2.0.0 into users' hands through proper distribution channels.

- [ ] **Submit AUR package** — `aur/PKGBUILD` is ready and tested. Needs the final v2.0.0 release tag, then `makepkg --printsrcinfo > .SRCINFO && git push` to AUR. See `aur/README.md`.
- [ ] **Publish plasmoid to KDE Store** — upload `plasmoid/package/` to [store.kde.org](https://store.kde.org) so it's discoverable in KDE Discover. Requires a KDE Identity account and screenshots.
- [ ] **Improve Windows installer UX** — `install.bat` works but is opaque. Consider a brief progress output or a summary of what was installed (service name, port, web UI URL).

### Fan Profiles

> One-click presets instead of manually editing fan tables. Every major competitor has this.

- [ ] **Define preset profiles** — at minimum: Silent (low fan speeds, higher temps tolerated), Balanced (current defaults), Performance (aggressive cooling, lower temps, louder). Each profile is just a pair of `cpuFanTable` + `gpuFanTable` values.
- [ ] **Backend support** — add a `profiles` field to state/config with named presets. Add a `MessageToServerKind.SetProfile` message kind. Switching profiles swaps the fan tables and persists the choice.
- [ ] **Frontend UI** — profile selector (dropdown or segmented control) above the fan curve editor. Active profile highlighted. Editing a fan table after selecting a profile switches to "Custom".
- [ ] **Plasmoid integration** — profile switcher in the full representation and as a right-click context menu action for quick switching without opening the popup.
- [ ] **Protocol version** — bump `protocolVersion` to `"1.1"` since this adds new message kinds. Older clients should gracefully ignore unknown fields.

### Temperature History

> The frontend and plasmoid show point-in-time snapshots. A rolling chart would make thermal behavior visible.

- [ ] **Server-side ring buffer** — store the last N minutes of `FanControlActivity` data (temps, fan speed, target). Broadcast as part of activity updates or on a separate `history` message kind.
- [ ] **Frontend sparkline** — lightweight rolling chart (last 10-30 minutes) showing CPU temp, GPU temp, and fan speed over time. Libraries to consider: [uPlot](https://github.com/leeoniya/uPlot) (tiny, fast), or a simple canvas-based sparkline since we only need ~180 data points.
- [ ] **Plasmoid tooltip chart** — optional mini-graph in the rich tooltip showing recent temperature trend. QML `Canvas` or `ChartView` from QtCharts.

### Dynamic Polling (Thinkfan-style)

> The current 10s cycle is fixed. Thinkfan drops to 2s on temperature spikes and recovers to 5s when stable. We can do the same.

- [ ] **Adaptive `CYCLE_DURATION`** — if temperature delta between consecutive cycles exceeds a threshold (e.g. 5 degrees C), temporarily halve the cycle duration for the next 2-3 cycles, then gradually recover.
- [ ] **Adaptive `TEMP_POLL_INTERVAL`** — could increase the poll interval during stable periods (e.g. 5s instead of 2s when delta < 1 degree C per cycle), reducing ACPI/WMI calls further.
- [ ] **Make thresholds configurable** — add to config file so users can tune aggressiveness vs. battery savings.

### Battery-Aware Mode

> Same behavior whether on AC or battery. Should behave differently.

- [ ] **Detect power source** — Linux: read `/sys/class/power_supply/*/online`. Windows: `GetSystemPowerStatus` via FFI or WMI `Win32_Battery`.
- [ ] **Battery profile** — when on battery, optionally: use a more conservative fan profile (Silent), increase `CYCLE_DURATION` (e.g. 15-20s), increase plasmoid keepalive even further.
- [ ] **Frontend indicator** — show current power source in the UI. Could be as simple as a small battery/plug icon.

---

## Nice to Have

> Valuable improvements that aren't blocking the release or core experience.

### Windows System Tray App

The biggest platform gap. Windows users only have the web UI — no desktop integration at all. Linux users get the full KDE Plasma widget.

**Options:**

- **Lightweight native tray** (C# `NotifyIcon` + WinForms, single .exe) — smallest footprint, no framework overhead. Shows temp/fan in tooltip, left-click opens web UI, right-click for profile switching. Connects to the same `ws://localhost:5522/ws` WebSocket.
- **Tauri** — cross-platform, Rust backend + web frontend. Could reuse the existing React frontend in a tiny window. More overhead than native but more maintainable.
- **Electron** — heaviest option, probably overkill for a tray icon.

Recommendation: start with the native C# approach for minimal resource usage, matching the project's low-power philosophy.

### Desktop Notifications

- [ ] **Linux** — `libnotify` / D-Bus notifications for high temperature warnings (e.g. CPU > 95 degrees C sustained), fan control failures, or service restarts.
- [ ] **Windows** — toast notifications via PowerShell or the Windows notification API.
- [ ] **Configurable thresholds** — let users set their own warning temperatures and choose which events trigger notifications.

### CPU Tuning on Windows 11

Windows 11 blocks Intel XTU from setting PL1/PL2 limits. The README notes this limitation.

- [ ] **Research MSR-based approach** — ThrottleStop writes directly to Model-Specific Registers (MSRs) to set power limits, bypassing XTU. This works on Windows 11 but requires a kernel driver or direct MSR access.
- [ ] **Evaluate feasibility** — MSR access requires either a signed driver (like ThrottleStop uses `RwDrv.sys`) or running with admin + enabling test signing. May be too complex or risky for a general-purpose tool.
- [ ] **Alternative: document workaround** — link to ThrottleStop as a companion tool for Windows 11 CPU tuning, since ALFC handles fan control and ThrottleStop handles PL limits.

### Improved Fan Curve Editor

- [ ] **Visual curve editor** — drag-and-drop points on a temperature-vs-speed graph instead of editing number pairs in a table. Both frontend and plasmoid.
- [ ] **Import/export fan tables** — share profiles as JSON files.
- [ ] **Validation warnings** — warn if fan speed is 0% at high temperatures, or if the curve has large gaps.

### Logging & Diagnostics

- [ ] **Structured logging** — add log levels (debug/info/warn/error) with timestamps. Currently uses bare `console.log`/`console.warn`/`console.error`.
- [ ] **Log rotation on Windows** — WinSW logs to `service.log` which grows unbounded. Add log rotation or size limits.
- [ ] **Diagnostic endpoint** — `/api/status` HTTP endpoint returning current state, uptime, platform info, version. Useful for troubleshooting without opening the full UI.

---

## Future Work (Contributions Welcome)

> Longer-term ideas that would make great community contributions.

### RGB Lighting Control

> From the original wishlist: using RGB lighting to highlight caps/num lock.

There's prior art for the Gigabyte Aero in [AeroCtl.Rgb.LockKeys](https://gitlab.com/wtwrp/aeroctl/-/tree/master/Samples/AeroCtl.Rgb.LockKeys). This could potentially be adapted for Aorus models. Should probably be a separate tool or an opt-in module since RGB is unrelated to fan control.

### Broader Laptop Model Support

The compatibility table is limited to models that have been tested:

| Model        | Fan control     | CPU limits | GPU boost       |
| ------------ | --------------- | ---------- | --------------- |
| Aorus 15G    | W10, W11, Linux | W10, Linux | W10, W11, Linux |
| Aorus 15G XC | W10, Linux      | W10, Linux |                 |
| Aorus 15P XD | W10             | W10        |                 |
| Aorus 15 FSB | W11             |            |                 |
| Aorus 5 SE4  | W11             |            |                 |
| Aero 15 SA   | W10, W11, Linux |            |                 |

Expanding this requires:

- Users with untested models willing to try and report results
- Documenting how to discover WMI method IDs for a new model (using `acpimof.dll` + WMI Explorer)
- Possibly model-specific config files if method IDs differ

### Linux Package Formats

- [ ] **Flatpak** — sandboxed distribution, but needs access to `/proc/acpi/call` which complicates sandboxing.
- [ ] **`.deb` / `.rpm`** — traditional packages for Debian/Ubuntu and Fedora/openSUSE. Straightforward but requires maintaining package specs.
- [ ] **Nix package** — for NixOS users. Would need a `flake.nix`.

### GNOME / Other DE Integration

The current desktop widget only supports KDE Plasma 6. GNOME Shell extensions use JavaScript and could connect to the same WebSocket backend. Other DEs (XFCE, Cinnamon) could be supported via a generic system tray icon using `libappindicator`.

### Mobile / Remote Monitoring

The web UI already works from any browser on the local network. Could be extended with:

- **PWA support** — add a manifest for "install to home screen" on phones.
- **Authentication** — if exposed beyond localhost, add token-based auth to the WebSocket.
- **mDNS discovery** — advertise the service so mobile apps can find it without knowing the IP.

---

## Technical Debt

> Known issues that don't affect functionality but should be cleaned up.

- [ ] **`any` in protocol types** — `common/types.ts` line 72 uses `data?: any` on `MessageToServer`. Should be a discriminated union matching each `MessageToServerKind` with its specific payload type.
- [ ] **`any` in test setup** — `test-setup.ts` line 25 has an `any` for the Vitest mock setup. Minor, but flagged by ESLint.
- [ ] **Windows-only LSP noise** — `WmiDll.cpp` shows cascading errors on Linux (missing `windows.h`). Not a real issue (compiles fine on Windows CI) but clutters IDE diagnostics. Could add an `.editorconfig` or workspace setting to suppress.
- [ ] **`acpi_call` installation friction** — the Linux setup requires manually building and loading a kernel module. The `LINUX.md` wishlist mentions automating this but secure boot signing and distro differences make it hard.
