# ALFC WebSocket Protocol

**Protocol version:** `1.1`

## Versioning policy

- **Additive changes** (new message kinds, new optional fields, new fields in server-push state) → **minor bump** (e.g. `1.1`).
- **Breaking changes** (removals/renames/shape changes) → **major bump** (e.g. `2.0`) with a **deprecation period** where the previous major is still accepted.
- Clients should treat `protocolVersion` as the authoritative version of the server contract.
- **Current version `1.1`**: added the optional `requestId` request-correlation field (additive; see Message envelope).
- **Current version `1.1` telemetry addition**: `FanControlActivity` carries `sensorFailure: boolean` to report failed sensor collection cycles while preserving last-known temperature averages.

## Connection lifecycle & client expectations

- **Endpoint:** `ws://localhost:5522/ws`
- **Initial state push:** on `open`, the server immediately sends a `state` message containing the full `State` object, including `protocolVersion: "1.1"`.
- **State broadcast:** after any successful state mutation (`fixedpercentage`, `dofixedspeed`, `fantable`, `tune`, supported `set` calls), the server publishes a fresh `state` snapshot to all connected sockets.
- **Keepalive:** server sets `idleTimeout: 120` (120s) and `sendPings: true` (automatic WebSocket protocol `PING` frames, which browsers answer automatically). The server also replies `"pong"` to plain-text `"ping"` frames (used by the KDE Plasma widget's 25s heartbeat / 60s watchdog).
- **Reconnect:** clients should auto-reconnect and expect the initial state push on every new connection.
- **Activity stream:** to receive `fancontrolactivity` updates, the client must send `registeractivitysocket` once per connection.

## Message envelope

### Client → Server

All JSON messages follow this envelope:

```json
{
  "kind": "<MessageToServerKind>",
  "methodId": "<client-generated id>",
  "methodName": "<method name>",
  "requestId": "<optional correlation id>",
  "data": "<kind-specific payload>"
}
```

- In `common/types.ts`, `MessageToServer` declares `methodId` and `methodName` (and the KDE Plasmoid populates both on every request).
- For `get`/`set`, `methodId` (Linux ACPI opcode) and `methodName` (Windows WMI method name; also checked by `set` for `SetAIBoostStatus`) are passed through to the platform layer.
- For other kinds (`registeractivitysocket`, `fixedpercentage`, `dofixedspeed`, `fantable`, `tune`), the server does not require `methodId` or `methodName` at runtime; when provided as strings they are echoed back in responses. The React Web UI omits `methodName` on non-WMI config mutations so it can distinguish config-change `success` responses from WMI `get`/`set` responses.
- `requestId` is optional. When a request carries it, the server echoes it back unchanged in that request's `success`/`error` response. Use it to attribute responses to your own requests — e.g. when two components issue the same WMI opcode concurrently. Server-initiated pushes never carry it.

### Server → Client

Response messages echo `methodId`, `methodName`, and `requestId` whenever the client supplied them on the request. Server-initiated push messages (`state`, `fancontrolactivity`) never include those fields.

## Client → Server message kinds

| Kind                     | Required fields                          | `data` shape                       | Response kind        | State mutation                                                                                                                                                                 | Notes                                                                                                                                                            |
| ------------------------ | ---------------------------------------- | ---------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registeractivitysocket` | `kind`                                   | _none_                             | _none_               | none                                                                                                                                                                           | Subscribes this socket to the activity pub/sub channel.                                                                                                          |
| `fixedpercentage`        | `kind`, `data`                           | `number`                           | `success` or `error` | `state.fixedPercentage` set; persists; if fixed mode is already enabled, success is only sent after the stored speed is applied successfully; broadcasts updated `state`       | Requires an integer from `0` to `100`, and fan control availability.                                                                                             |
| `dofixedspeed`           | `kind`, `data`                           | `boolean`                          | `success` or `error` | `state.doFixedSpeed` set; persists; if `true` then immediately applies the stored fixed speed before reporting success, if `false` then `autoFanControl()`; broadcasts `state` | Requires fan control availability.                                                                                                                               |
| `fantable`               | `kind`, `data`                           | `{ cpu: FanTable, gpu: FanTable }` | `success` or `error` | `state.cpuFanTable`, `state.gpuFanTable` set; persists; broadcasts updated `state`                                                                                             | Both tables must be non-empty, strictly ascending by temperature, and use percentages from `0` to `100`.                                                         |
| `tune`                   | `kind`, `data`                           | `{ pl1: number, pl2: number }`     | `success` or `error` | `state.pl1`, `state.pl2` set on success; persists; `tune()` invoked; broadcasts updated state                                                                                  | Requires integer `pl1`/`pl2` values from `0` to `200`, and CPU tuning availability.                                                                              |
| `get`                    | `kind`, `methodId`, `methodName`         | `Args` (optional)                  | `success` or `error` | none                                                                                                                                                                           | Calls `getCall(methodId, methodName, data)`; `success.data` contains result. Returns `ACPI_ERROR` if `getCall` resolves to `NaN`, or `INTERNAL_ERROR` if thrown. |
| `set`                    | `kind`, `methodId`, `methodName`, `data` | `Args`                             | `success` or `error` | If `methodName === "SetAIBoostStatus"`, sets `state.gpuBoost = data.Data === 1`, persists, and broadcasts updated `state`                                                      | `SetAIBoostStatus` requires `data.Data` to be `0` or `1`, and GPU boost availability.                                                                            |

If an unknown `kind` is received, required `data` is missing, the payload is invalid, or a feature is unavailable, the server responds with a structured error code:

```json
{ "kind": "error", "data": "INVALID_JSON: Failed to parse message" }
{ "kind": "error", "methodId": "...", "methodName": "...", "data": "UNKNOWN_KIND: <received kind>" }
{ "kind": "error", "methodId": "...", "methodName": "...", "data": "MISSING_DATA: <expected kind>" }
{ "kind": "error", "methodId": "...", "methodName": "...", "data": "INVALID_PAYLOAD: <message>" }
{ "kind": "error", "methodId": "...", "methodName": "...", "data": "INVALID_RANGE: <message>" }
{ "kind": "error", "methodId": "...", "methodName": "...", "data": "UNSUPPORTED_FEATURE: <message>" }
{ "kind": "error", "methodId": "...", "methodName": "...", "data": "ACPI_ERROR: <message>" }
{ "kind": "error", "methodId": "...", "methodName": "...", "data": "INTERNAL_ERROR: An unexpected error occurred" }
```

`ACPI_ERROR` is emitted when a `get` call resolves to `NaN` at the platform
layer (for example, when `/proc/acpi/call` is unavailable or fails on Linux).
Thrown platform errors from `get` (Windows WMI) or `set` (both platforms) return `INTERNAL_ERROR`.

When `methodId`, `methodName`, or `requestId` are present in the original request, they are echoed back in the error response.

## Server → Client message kinds

| Kind                 | Required fields | `data` shape         | Trigger                                                         | State mutation | Notes                                                                                                                                                                                    |
| -------------------- | --------------- | -------------------- | --------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state`              | `kind`, `data`  | `State`              | Sent immediately on `open` and after successful state mutations | none           | Includes `protocolVersion: "1.1"`.                                                                                                                                                       |
| `success`            | `kind`          | `unknown` (optional) | Successful completion of a client request                       | none           | Echoes `methodId`, `methodName`, and `requestId` when supplied on the request. For `get`, `data` is the native call result (`number`); for other requests, `data` echoes `payload.data`. |
| `error`              | `kind`, `data`  | `string`             | Failed/invalid client request or thrown error                   | none           | `data` is a structured error code string (e.g. `INVALID_JSON: ...`). Echoes `methodId`, `methodName`, and `requestId` when present as strings on the request.                            |
| `fancontrolactivity` | `kind`, `data`  | `FanControlActivity` | Published when telemetry updates                                | none           | Only delivered to sockets that subscribed with `registeractivitysocket`. Fixed mode still publishes telemetry.                                                                           |

## Data shapes

```ts
type FanTable = [number, number][];

type Args = { [key: string]: number };

type FanControlActivity = {
  appliedSpeed: number | null;
  avgCPUTemp: number;
  avgGPUTemp: number;
  target: number;
  // True when the last temperature collection failed: avgCPUTemp/avgGPUTemp
  // are the last successfully collected averages (not current measurements)
  // and fans were commanded to the highest configured speed. Until the first
  // successful collection of a run, no fancontrolactivity is published.
  sensorFailure: boolean;
};

type State = {
  protocolVersion: "1.1";
  cpuFanTable: FanTable;
  gpuFanTable: FanTable;
  doFixedSpeed: boolean;
  fixedPercentage: number;
  gpuBoost: boolean;
  pl1: number;
  pl2: number;
  isCpuTuningAvailable?: boolean;
  isGpuBoostAvailable?: boolean;
  isFanControlAvailable?: boolean;
};
```

## Security

- The websocket upgrade path enforces an Origin allowlist for browser clients: only `http://` or `https://` origins on `localhost`, `127.0.0.1`, or `[::1]` (with optional ports) are accepted.
- Missing `Origin` is accepted to keep compatibility with non-browser local clients (for example, QML).
- Disallowed origins are rejected with HTTP `403` before websocket upgrade.
- This is a localhost browser guardrail, not authentication: any local process that can connect directly to `localhost:5522` can still use the protocol.
