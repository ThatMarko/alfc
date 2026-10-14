# ALFC WebSocket protocol

The current server emits protocol **1.1**. This document describes the wire
contract implemented by
[types.ts](https://github.com/ThatMarko/alfc/blob/feat/wmi-ffi/common/types.ts),
[protocol.ts](https://github.com/ThatMarko/alfc/blob/feat/wmi-ffi/common/protocol.ts),
[validation.ts](https://github.com/ThatMarko/alfc/blob/feat/wmi-ffi/common/validation.ts),
and the
[server handlers](https://github.com/ThatMarko/alfc/blob/feat/wmi-ffi/server/websocket/index.ts).
Client and platform support is
listed in [COMPATIBILITY.md](COMPATIBILITY.md).

## Connection lifecycle

The production HTTP UI and `/ws` endpoint share port **5522**. During development,
Vite serves the web UI on port 3000 and connects to the backend on 5522. The backend binds
`127.0.0.1` and `::1` explicitly; IPv6 is optional when the operating system does
not support it. It never binds a wildcard address. Supported endpoint forms are:

- `ws://localhost:5522/ws`
- `ws://127.0.0.1:5522/ws`
- `ws://[::1]:5522/ws`, when IPv6 is available

Both listeners share one state and request queue. A mutation from either address
broadcasts the same state to clients on both. Each connection immediately receives
a full `state` snapshot and is subscribed to subsequent state updates.

Send `{"kind":"registeractivitysocket"}` once per connection to subscribe to
`fancontrolactivity`. Registration has no acknowledgement and bypasses the
hardware queue, including when that queue is full. Reconnecting creates a new
connection: subscribe again and use its new initial state.

Bun sends WebSocket protocol pings automatically (`sendPings: true`); the idle
timeout is 120 seconds. Browser WebSocket implementations answer those protocol
pings. ALFC also accepts a plain text `ping` message and answers plain text `pong`.
The Plasma client uses this application heartbeat every 25 seconds, with a
60-second response watchdog. Heartbeats bypass the hardware queue.

Messages are limited to **64 KiB**. Connections exceeding **1 MiB** of outbound
backpressure are closed. At most **64** queued or executing JSON hardware/config
requests are admitted across all connections. An excess request receives `BUSY`;
subscription and heartbeat traffic remain available.

## Protocol versions and correlation

Current shipped clients require **1.1 or a later minor version of major 1**.
Protocol 1.0 lacks the `requestId` echo needed to safely match concurrent commands
and is rejected by current client guards. Version strings must match the complete
`1.<minor>` form; whitespace, trailing newlines, and extra version components are
invalid. Future minor versions may add optional fields; clients ignore unknown
fields. A major change requires an explicit compatibility plan and an updated
version, implementation, tests, and both protocol documents.

The 1.1 server still accepts requests without `requestId` for older/custom local
clients. Such clients must obey the current payload and method validation rules.
This does not make current clients compatible with a 1.0 server.

## Message envelope

A native GPU-boost request illustrates the complete envelope:

```json
{
  "kind": "set",
  "methodId": "129",
  "methodName": "SetAIBoostStatus",
  "requestId": "my-client-42",
  "data": { "Data": 1 }
}
```

`kind` identifies the operation. For `get` and `set`, `methodId` is the firmware
opcode, not a request identifier; it accepts decimal or `0x` hexadecimal notation.
`methodName` must identify the same method in the shared
[MOF catalog](https://github.com/ThatMarko/alfc/blob/feat/wmi-ffi/common/methods.ts).
Both fields are required for these native operations.
For configuration and subscription messages they are optional metadata.

`requestId` is optional in the server envelope. Current clients generate a unique
ID per request and match only that request's response. The server echoes string
`methodId`, `methodName`, and `requestId` fields in `success` and `error` messages.
Other request properties are not reflected. Server pushes contain no request
metadata. Clients must reject pending operations on timeout/disconnect and must
not replay a write after reconnecting: a lost acknowledgement does not prove that
hardware rejected the original write.

## Client messages

| `kind`                   | Required `data`                        | Behavior                                                                                                                                                      |
| ------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registeractivitysocket` | None                                   | Subscribe this connection to telemetry; no response.                                                                                                          |
| `fixedpercentage`        | Integer `0..100`                       | Store the fixed percentage. In fixed mode, apply both fan writes before committing the value. In automatic mode, store it for the next fixed-mode activation. |
| `dofixedspeed`           | Boolean                                | `true` applies the stored fixed percentage before committing the mode. `false` resumes the existing curve loop from the confirmed current speed.              |
| `fantable`               | `{ "cpu": FanTable, "gpu": FanTable }` | Store both validated curves. The next automatic cycle uses their target at the measured temperature.                                                          |
| `tune`                   | `{ "pl1": number, "pl2": number }`     | Apply integer watt limits `0..200` through the native backend, then commit both settings on success.                                                          |
| `get`                    | Optional `Args`                        | Read a validated catalog method. Methods with inputs require their complete argument map.                                                                     |
| `set`                    | `Args`                                 | Write a validated catalog method. GPU boost additionally updates `state.gpuBoost`; other diagnostic setters have no corresponding persisted State field.      |

All configuration mutations require the relevant capability to be available.
Current servers explicitly report the capability booleans after native
initialization; an explicit `false` produces `UNSUPPORTED_FEATURE`.

The Windows CPUOC/Intel XTU adapter is an **unsupported prototype**. Standard
release archives do not include `CPUOC.dll` or proprietary XTU SDK dependencies.
An experimental build/publication requires a separately validated legacy SDK
dependency closure and explicit opt-in; the existence of the `tune` message does
not establish Windows CPU-tuning support. Linux RAPL tuning is a separate backend.
See [PORTING_REVIEW.md](../PORTING_REVIEW.md) for the Windows gate and limitations.

A `FanTable` is a non-empty array of `[temperature, percentage]` pairs. Both
numbers must be finite; temperatures are `0..110` degrees Celsius and strictly
ascending, and percentages are `0..100`. Fractions are valid. Percentages need not
ascend. Selection is stepwise: choose the highest temperature threshold at or
below the measured temperature, or the first row below the first threshold. The
higher CPU/GPU target commands both fans because the heat pipes are shared.

Native `Args` must contain exactly the documented input names, without missing or
extra keys. Values must be integers fitting the declared unsigned type (`uint8`:
`0..255`; `uint16`: `0..65535`). The server orders inputs by the catalog signature
so Linux positional packing and Windows named arguments agree. Supplying an
opcode/name mismatch, whitespace in an opcode, or an unknown method is invalid.
`SetAIBoostStatus` additionally requires `Data` to be `0` or `1` and GPU-boost
availability.

Raw setters listed in `managedFanMethods` are rejected with
`MANAGED_FAN_CONTROL`: they would bypass the authoritative fan controller. This
includes direct fan duty/speed, automatic/fixed/step mode, deep-fan curves, fan
indices, super-quiet mode, fan adjustment, and fan-off commands. Use the managed
percentage, mode, and curve messages instead. Other catalog diagnostics remain
available in the web Raw UI; the Plasma widget exposes the primary managed
controls rather than the raw catalog.

## Ordering, state, and persistence

Admitted requests are serialized across both listeners and every client. For an
immediate hardware operation, configuration state changes only after the native
backend reports success. A mode change, stored inactive percentage, or curve
change can be acknowledged before a later control cycle changes physical output;
its acknowledgement confirms the configuration. Telemetry identifies the last
successfully acknowledged paired fan command, not a measured physical output.

For a successful configuration change the server saves, broadcasts `state`, and
then acknowledges the request. Production saves serialize captured snapshots to
`alfc.config.json.tmp` and rename that file over `alfc.config.json`. This avoids
interleaved temporary-file writes and partial JSON replacement. It does not
promise persistence across sudden power loss. Development mode intentionally
keeps changes in memory and does not write the config file. Uncompiled source
loads the repository-root config, including when `NODE_ENV=production` enables
persistence. A compiled executable loads/saves the config beside that executable;
production source mode never redirects config to the Bun installation directory.

If a file save fails after the configuration becomes active, the active state is
still broadcast and the caller receives `PERSISTENCE_ERROR`. The server does not
claim to have reverted hardware. A failed native operation does not commit the
new configuration; partial hardware writes may still require recovery, so clients
must not infer physical rollback from an error response.

The configuration loader uses the same curve, fixed-percentage, and power-limit
constraints. An absent, malformed, or invalid file selects the complete defaults:
CPU `[[40,15],[83,50],[88,100]]`, GPU `[[40,15],[78,50],[83,100]]`, automatic mode,
50% stored fixed speed, GPU boost enabled, PL1 37 W, and PL2 106 W. Only these
settings are loaded/saved. `protocolVersion`, capability flags, `restartRequired`,
and unknown properties cannot be injected through a config file.

## Server messages and errors

| `kind`               | `data`                                                                | Meaning                                                                      |
| -------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `state`              | Full `State`                                                          | Initial snapshot, active configuration update, or runtime capability change. |
| `success`            | Native result for `get`; otherwise the request's `data`, when present | The correlated operation completed. Subscription has no success response.    |
| `error`              | String `CODE: detail`                                                 | The correlated request failed or was rejected.                               |
| `fancontrolactivity` | `FanControlActivity`                                                  | Telemetry for subscribed connections, including fixed mode.                  |

| Error code            | Trigger                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------- |
| `INVALID_JSON`        | The message cannot be parsed as JSON.                                                   |
| `UNKNOWN_KIND`        | Missing or unsupported operation kind.                                                  |
| `MISSING_DATA`        | A required `data` value is absent or `null`.                                            |
| `INVALID_PAYLOAD`     | Wrong shape, invalid curve/signature, opcode/name mismatch, or invalid GPU-boost value. |
| `INVALID_RANGE`       | Invalid fixed percentage or CPU watt limit.                                             |
| `UNSUPPORTED_FEATURE` | The relevant capability is explicitly unavailable.                                      |
| `ACPI_ERROR`          | A native `get` returns a non-finite numeric result, including Linux read failure.       |
| `MANAGED_FAN_CONTROL` | A raw setter attempts to bypass managed fan control.                                    |
| `BUSY`                | The shared 64-request capacity has been reached.                                        |
| `SHUTTING_DOWN`       | New or queued work is rejected during shutdown.                                         |
| `PERSISTENCE_ERROR`   | The configuration is active but its file save failed.                                   |
| `RESTART_REQUIRED`    | A native channel failed permanently and cannot safely accept another call.              |
| `INTERNAL_ERROR`      | Other thrown native/handler failures; new configuration was not committed.              |

For example:

```json
{
  "kind": "error",
  "requestId": "my-client-42",
  "data": "PERSISTENCE_ERROR: Configuration is active but could not be saved"
}
```

Malformed JSON cannot provide trusted correlation metadata. Valid JSON requests
retain their string metadata in error responses, including shutdown rejection.

A `get` returns an ordinary JSON number within `Number.MAX_SAFE_INTEGER`, or an
exact decimal string for larger packed results such as the ten-byte `GetDeepFan`
response. Preserve that string; converting it to a JavaScript number loses
precision. Both platforms pack output in declared parameter order and widths.
The web Raw UI displays the exact value and hexadecimal form.

## Telemetry and runtime capability changes

```ts
type FanControlActivity = {
  appliedSpeed: number | null;
  avgCPUTemp: number;
  avgGPUTemp: number;
  target: number;
  sensorFailure?: boolean;
};
```

The loop runs on a nominal two-second interval. Automatic mode averages three
CPU/GPU sample sets with 500 ms spacing; fixed mode collects one set per cycle.
Slow native calls can make ticks skip rather than overlap. Ramp-up uses each
eligible cycle; ramp-down waits 30 consecutive eligible cooling cycles. Normal
curve ramps move partway toward the target. Curve edits select the new target at
the measured temperature without resetting to the minimum.

Automatic startup commands the highest configured target before the first sensor
collection. It retains that safe target through failed initial collections, then
applies the measured curve target immediately when a valid collection arrives.
The ordinary cooling delay starts after that first measured target. Fixed-mode
startup applies the user's stored fixed percentage instead.

`appliedSpeed` is the last requested percentage whose paired fan writes completed
successfully at the native interface. It is not tachometer feedback, actual RPM,
or proof that either fan is rotating at the requested duty. Raw `getRpm1` and
`getRpm2` diagnostics are separate from this telemetry. The value is `null` after
a failed/partial write; this is an unconfirmed command, not zero RPM.
A sensor failure in automatic mode commands the highest percentage anywhere in
either configured curve. Fixed mode retains its selected target and retries
unconfirmed writes even while sensors fail.

On a failed collection, `sensorFailure: true` marks the temperatures as the last
successful averages, not fresh measurements. Until the first successful
collection of a run, no activity with invented temperatures is published. Clients
show waiting/stale telemetry instead. Absence of the optional `sensorFailure`
field means no explicit failure flag; it does not replace stale detection. Both
shipped clients mark telemetry older than ten seconds stale.

A fatal native channel failure sets the affected capability flags to `false`,
latches runtime-only `restartRequired: true`, and broadcasts the snapshot. New
connections receive the same warning. On Windows, CPU tuning and WMI fan/GPU
operations use separate channels; one failed feature does not disable the other
channel. A Linux CPU-tuning rollback that cannot be verified also disables tuning
and requests a restart. Restart ALFC to retry a permanently failed channel.
A timeout cannot guarantee cancellation of an operation already executing in a
driver or firmware.

## Security boundary

Browser upgrades require an `http` or `https` Origin on `localhost`, `127.0.0.1`,
or `[::1]`; ports may vary. Origins containing credentials, paths, queries, or
fragments are rejected. Missing Origin is allowed for native clients such as QML.
Rejected Origins receive HTTP 403 before upgrade. `/ws` requires GET.

This is a privileged local control interface. Loopback binding and the Origin
check restrict browser access; they are not authentication against another local
process. The native catalog and managed-command validation remain mandatory on
both operating systems.

Bun's limits and ping behavior are documented in the official
[WebSocket API](https://bun.sh/docs/runtime/http/websockets); implementation-facing
API details also appear in the installed `bun-types/serve.d.ts` declarations.
