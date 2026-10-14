# ALFC Roadmap

This distinguishes code present on `feat/wmi-ffi` (PR #1) from proposed work.
It does not certify hardware compatibility or announce a stable release.
Use [issues](https://github.com/ThatMarko/alfc/issues) for current priorities and
[PORTING_REVIEW.md](PORTING_REVIEW.md) for actual validation evidence.

## Implemented on this branch

- Bun 1.4.3 workspaces and compiled Linux/Windows server outputs; no separate
  Node runtime is needed by packaged production executables.
- Windows WMI through ABI 2 C++/COM FFI on one dedicated worker, with bounded
  waits for method completion, typed input, declared output widths, and exact
  large values.
- Separate optional CPU worker and tuning queue, so a failed Intel channel does
  not automatically stop fan control. Failed channels downgrade capabilities
  and tell clients when a restart is required.
- Linux ACPI method packing and response validation, plus detected RAPL power
  constraints with application/readback/rollback handling.
- Paired, ordered fan writes, threshold curves, one-cycle ramp-up and 30-cycle
  ramp-down. A normal decision interval is two seconds; hardware and sampling
  affect wall-clock timing. This is not an end-to-end performance benchmark.
- React and Plasma 6 clients with authoritative snapshots, request IDs,
  capability-aware controls, reconnect without command replay, per-setting
  drafts, and ten-second stale-telemetry handling. Raw diagnostics are web-only.
- Explicit IPv4/IPv6 loopback serving, validated HTTP paths and browser origins,
  bounded WebSocket work, serialized persistence, and bounded shutdown/BIOS
  restoration attempts.
- Linux/Windows CI, Chromium scenarios, native export/packing checks, and Qt
  runtime tests. Headless tests supplement physical validation.

## Before a production release

- [ ] Validate fan, temperature, and supported GPU calls on physical Windows
      and Linux laptops, including failed calls and partial initialization.
- [ ] Validate service stop, OS shutdown, BIOS automatic-control handoff,
      and Intel driver readback/rollback on real hardware.
- [ ] Validate the complete widget in supported Plasma 6 sessions, including
      panel, tray, desktop, keyboard access, scaling, and simultaneous web clients.
- [ ] Measure complete hardware request latency and idle power/CPU use. Historical
      measurements and raw FFI overhead do not measure this implementation.
- [ ] Resolve the optional Windows CPUOC deployment boundary. The bundled legacy
      .NET Framework SDK depends on WCF/XTU and additional assemblies; current
      NativeAOT publication is experimental and is excluded from standard releases.
- [ ] Verify final archives, architecture requirements, checksums, and install /
      upgrade / uninstall behavior on target machines. See [RELEASING.md](RELEASING.md).
- [ ] Publish and validate Arch package metadata after final release assets exist;
      the checked-in template is not proof of AUR publication.
- [ ] Prepare current widget screenshots and publish to KDE Store if desired.

## Proposed user features

### Named profiles

Add named CPU/GPU curve pairs, a protocol message, persistence, and matching
web/widget selectors. Define how editing a preset transitions to a custom
profile. Version the wire addition and specify older-client behavior before
implementation.

### Temperature history

Store a bounded history and expose it through a documented message. Add web
and widget visualizations with explicit stale/error behavior and bounded memory.
Current telemetry is a snapshot, not a history API.

### Adaptive polling and power source

Evaluate configurable temperature sampling and AC/battery detection on measured
hardware. Preserve thermal responsiveness, serialized calls, and bounded failure
handling. Avoid promising power savings before measurements.

### Editing and diagnostics

- Import/export validated curve files and optional graphical point editing.
  The widget already renders threshold-step curves; draggable points are future work.
- Structured log levels, redacted diagnostic export, and a documented read-only
  health endpoint. No HTTP diagnostics API currently exists.
- Optional desktop temperature/failure notifications with user-set thresholds.
- Investigate a Windows tray client and non-KDE Linux desktop integrations using
  the same documented backend protocol.

## Longer-term investigations

Broader models need verified method catalogs and device reports, not copied
firmware assumptions. Additional distribution formats need explicit privileged
backend integration. RGB control should remain a separate or opt-in feature.

Remote monitoring would require a new authenticated architecture: the current
service is loopback-only and has no login or token protocol. The existing web
manifest does not establish an offline PWA, LAN access, mobile discovery, or a
supported remote-control service. Any such work must define authorization,
transport security, and the effect of disconnects before exposure.
