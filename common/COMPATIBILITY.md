# ALFC compatibility matrix

The current server emits **protocol 1.1**. This matrix describes the shipped
source, not a hardware certification or a promise about every historical binary.
See [PROTOCOL.md](PROTOCOL.md) for the exact envelope, constraints, and errors.

## Client compatibility

| Client                                   | Supported backend protocol                  | Platform                                   | Scope                                                                                                                                 |
| ---------------------------------------- | ------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Current React web UI                     | 1.1 and later major-1 minors                | Modern desktop browser on Linux or Windows | Managed fan mode/percentage/curves, CPU tuning, GPU boost, telemetry, and web-only raw diagnostics.                                   |
| Current Plasma widget                    | 1.1 and later major-1 minors                | KDE Plasma 6 on Linux                      | The same primary managed controls and telemetry, with panel, tray, and desktop presentations.                                         |
| Older/custom clients without `requestId` | The 1.1 server still accepts their envelope | Local WebSocket client                     | Must obey current method/payload validation; responses can echo method metadata, but safe correlation is the client's responsibility. |
| Current clients with a 1.0 server        | Unsupported                                 | Any                                        | Current clients require the request correlation introduced in 1.1 and reject the snapshot.                                            |

Both current clients validate incoming snapshots and telemetry before using them,
correlate their commands with `requestId`, stop pending commands on connection
loss, and mark activity older than ten seconds stale. They resubscribe after
reconnecting and do not replay uncertain writes. Sharing one machine or listening
on a different loopback address does not create separate backend state.

The server accepts JSON requests in text frames and valid UTF-8 binary frames,
and sends responses in text frames. Malformed UTF-8 binary input receives
`INVALID_JSON` without executing a command or echoing corrupted request metadata.

A client accepting a major-1 minor version still requires the documented base
fields and valid values. Unknown optional fields are ignored. Malformed version
strings, protocol 1.0, and other major versions are rejected by current guards.

## Capability-dependent behavior

| State field             | Meaning when `true`                                                       | Behavior when `false` or unavailable                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `isFanControlAvailable` | Native fan control initialized.                                           | Explicit `false` disables fan mutations. Absence is retained for older-server compatibility; the fan UI uses its legacy permissive behavior. |
| `isCpuTuningAvailable`  | CPU power-limit initialization and initial tuning succeeded.              | CPU tuning controls require explicit `true`; a failed optional tuning backend does not disable fan control.                                  |
| `isGpuBoostAvailable`   | The initial validated GPU-boost command succeeded.                        | GPU-boost controls require explicit `true`.                                                                                                  |
| `restartRequired`       | A native channel permanently failed and ALFC needs a restart to retry it. | Missing/`false` means no restart warning is asserted. This flag alone does not disable unaffected features.                                  |

Current servers initialize and report capability booleans from the running native
services. Capability flags describe backend availability, not a guarantee that
firmware will accept every later operation. Runtime failures can downgrade them
and push new state. Configuration files cannot override capabilities or inject a
restart warning; those fields are never persisted.

`fixedPercentage` is an integer `0..100`; CPU limits are integer watts `0..200`.
CPU/GPU curves accept non-empty, strictly ascending temperatures `0..110` and
percentages `0..100`, including fractions. These constraints are shared by the
server, web UI, and widget. Curves may have non-monotonic speeds. Errors use
`INVALID_RANGE` or `INVALID_PAYLOAD`; `INVALID_DATA` and `INVALID_FAN_TABLE` are
not emitted wire codes.

A configuration acknowledgement and the paired-command result in telemetry have
different meanings. Stored inactive percentages and curves can be accepted before
a later control cycle issues a new fan command. Both clients derive active
configuration from state broadcasts and the last successfully acknowledged paired
fan command from telemetry. `appliedSpeed` is a requested percentage, not actual
RPM or proof of physical fan rotation. Raw RPM diagnostic reads are separate.
`appliedSpeed: null` means a fan write is unconfirmed; it must not be displayed as
a confirmed zero or maximum.

## Native platform support

| Component                     | Linux                                                                                                                                | Windows                                                                                                                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fan/temperature/GPU interface | `/proc/acpi/call` using the catalog opcodes and positional byte packing; needs the `acpi_call` kernel module and supported firmware. | `WmiDll.dll` using the catalog WMI method/argument names in a dedicated worker; needs the supported AORUS WMI classes and an elevated token.                                                                                                             |
| CPU power limits              | Writable CPU package `intel-rapl` sysfs power-limit interfaces; unsupported machines report tuning unavailable.                      | Unsupported CPUOC/Intel XTU prototype, excluded from standard archives. Experimental builds/publication require explicit opt-in and an independently validated proprietary legacy SDK dependency closure; see [PORTING_REVIEW.md](../PORTING_REVIEW.md). |
| Failure isolation             | ACPI access is serialized. A kernel call already blocked in the kernel cannot be forcibly cancelled by a JavaScript timeout.         | CPU and WMI channels are separate. Permanently failed/timed-out channels are not reused and advertise `restartRequired`.                                                                                                                                 |
| Packaging                     | Bun-compiled executable plus frontend, config, and service scripts.                                                                  | Bun-compiled executable plus frontend, config, supported `WmiDll.dll`, and service wrapper. Standard archives omit CPUOC and the proprietary SDK.                                                                                                        |

Catalog support is not proof that every listed operation exists on every AORUS
model or BIOS. Unsatisfied native prerequisites should yield unavailable
capabilities or explicit operation errors. Hardware control requires elevation on
both platforms. The service listens only on IPv4/IPv6 loopback; it provides no
remote-management endpoint.

The raw method catalog is shared between both native backends and the web UI.
Inputs use their declared integer widths and canonical order. Large packed reads
are exact decimal strings when they exceed JavaScript's safe integer range.
Direct raw fan setters are intentionally rejected with `MANAGED_FAN_CONTROL` to
preserve the configuration/output relationship. The widget does not expose the
raw diagnostics catalog.

## Optional fields and evolution

| Field                              | Current contract                                                                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `State.protocolVersion`            | Required string; current server value `"1.1"`. Current clients require major 1, minor at least 1.                                                                                                 |
| State capability booleans          | Optional in the wire type for older snapshots; current servers populate them from initialization/runtime status.                                                                                  |
| `State.restartRequired`            | Optional runtime warning introduced in the current 1.1 implementation; never a saved preference.                                                                                                  |
| `FanControlActivity.sensorFailure` | Optional in the type; current control cycles emit a boolean. When true, temperatures are last-known. Fixed mode retains its chosen target; automatic mode commands its highest configured target. |
| `FanControlActivity.appliedSpeed`  | Number `0..100` or `null` when paired writes are unconfirmed.                                                                                                                                     |
| Request/response `requestId`       | Optional for server acceptance, required by current clients for safe command correlation. Server pushes do not contain it.                                                                        |

Before the first successful temperature collection, no activity with fabricated
measurements is emitted. Afterwards sensor failures reuse the last real averages
with `sensorFailure: true`; clients must present the failure rather than treat the
numbers as current. Fixed output recovery does not depend on sensor recovery.
Automatic startup uses the highest configured fan target until a valid collection
allows its measured curve target to replace it. Fixed-mode startup retains the
stored fixed percentage.

Additive protocol changes may introduce optional fields or messages that older
clients ignore. Changes that remove, rename, or change established required
fields need a major-version compatibility plan, coordinated clients, tests, and
updated protocol documents. Tightening native input validation and reserving
managed fan setters are intentional safety constraints; a raw client relying on
arbitrary opcodes or direct fan writes must migrate to supported commands.

## Validation and release evidence

`bun run all-checks` covers TypeScript, ESLint, Vitest contracts, and package
builds. Relevant tests include shared decoder checks, handler validation and
cross-listener broadcasts, persistence recovery, fan-control timing/failures, and
web/Qt guard parity. Browser tests and Qt Quick tests exercise their own runtime
behavior. Linux cloud checks can validate protocol behavior and package startup
without proving physical fan, RAPL, WMI, or XTU operation.

A release still needs recorded manual evidence for supported devices and desktop
sessions: Plasma installation/upgrade, panel/tray/desktop presentation, recovery
from a service restart, simultaneous web/widget changes, BIOS handoff on shutdown,
and real fan/power behavior on the target Linux/Windows systems. Build success,
mocked FFI tests, and a headless QML test are not substitutes for those checks.
See [PORTING_REVIEW.md](../PORTING_REVIEW.md) for the repository's validation scope.
