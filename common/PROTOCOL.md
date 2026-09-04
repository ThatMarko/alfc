# ALFC WebSocket Protocol

**Protocol version:** `1.1`

## Versioning policy

- **Additive changes** (new message kinds, new optional fields, new fields in server-push state) → **minor bump** (e.g. `1.1`).
- **Breaking changes** (removals/renames/shape changes) → **major bump** (e.g. `2.0`) with a **deprecation period** where the previous major is still accepted.
- Clients should treat `protocolVersion` as the authoritative version of the server contract.
- **Current version `1.1`**: added the optional `requestId` request-correlation field (additive; see Message envelope).

## Connection lifecycle & client expectations

- **Endpoint:** `ws://localhost:5522/ws`
- **Initial state push:** on `open`, the server immediately sends a `state` message containing the full `State` object, including `protocolVersion: "1.1"`.
- **State broadcast:** after any successful state mutation (`fixedpercentage`, `dofixedspeed`, `fantable`, `tune`, supported `set` calls), the server publishes a fresh `state` snapshot to all connected sockets.
- **Keepalive:** server has a ~30s idle timeout. Clients must send a plain-text `"ping"` at least every 30s; server responds with `"pong"`.
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
  "data": "<kind-specific payload>"
}
```

- `methodId` and `methodName` are required for all client requests.
- For `get`/`set`, `methodName` is the native method name and is passed through to the platform layer.
- For other kinds, `methodName` is echoed back in responses but is not used by the server logic.
- `requestId` is optional. When a request carries it, the server echoes it back unchanged in that request's `success`/`error` response. Use it to attribute responses to your own requests — e.g. when two components issue the same WMI opcode concurrently. Server-initiated pushes never carry it.

### Server → Client

Response messages include `methodId` and `methodName` from the request, plus `requestId` when the client supplied one. Server-initiated push messages (`state`, `fancontrolactivity`) are sent without those fields in the current implementation.

## Client → Server message kinds

| Kind                     | Required fields                          | `data` shape                       | Response kind        | State mutation                                                                                                                                                                 | Notes                                                                                                                     |
| ------------------------ | ---------------------------------------- | ---------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `registeractivitysocket` | `kind`, `methodId`, `methodName`         | _none_                             | _none_               | none                                                                                                                                                                           | Subscribes this socket to the activity pub/sub channel.                                                                   |
| `fixedpercentage`        | `kind`, `methodId`, `methodName`, `data` | `number`                           | `success` or `error` | `state.fixedPercentage` set; persists; if fixed mode is already enabled, success is only sent after the stored speed is applied successfully; broadcasts updated `state`       | Requires an integer from `0` to `100`, and fan control availability.                                                      |
| `dofixedspeed`           | `kind`, `methodId`, `methodName`, `data` | `boolean`                          | `success` or `error` | `state.doFixedSpeed` set; persists; if `true` then immediately applies the stored fixed speed before reporting success, if `false` then `autoFanControl()`; broadcasts `state` | Requires fan control availability.                                                                                        |
| `fantable`               | `kind`, `methodId`, `methodName`, `data` | `{ cpu: FanTable, gpu: FanTable }` | `success` or `error` | `state.cpuFanTable`, `state.gpuFanTable` set; persists; broadcasts updated `state`                                                                                             | Both tables must be non-empty, strictly ascending by temperature, and use percentages from `0` to `100`.                  |
| `tune`                   | `kind`, `methodId`, `methodName`, `data` | `{ pl1: number, pl2: number }`     | `success` or `error` | `state.pl1`, `state.pl2` set on success; persists; `tune()` invoked; broadcasts updated state                                                                                  | Requires integer `pl1`/`pl2` values from `0` to `200`, and CPU tuning availability.                                       |
| `get`                    | `kind`, `methodId`, `methodName`         | `Args` (optional)                  | `success` or `error` | none                                                                                                                                                                           | Calls `getCall(methodId, methodName, data)`; `success.data` contains result. A failed platform call returns `ACPI_ERROR`. |
| `set`                    | `kind`, `methodId`, `methodName`, `data` | `Args`                             | `success` or `error` | If `methodName === "SetAIBoostStatus"`, sets `state.gpuBoost = data.Data === 1`, persists, and broadcasts updated `state`                                                      | `SetAIBoostStatus` requires `data.Data` to be `0` or `1`, and GPU boost availability.                                     |

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

`ACPI_ERROR` is emitted when a `get` call fails at the platform layer (for
example, `/proc/acpi/call` is unavailable on Linux).

When `methodId` and `methodName` are present in the original request, they are echoed back in the error response.

## Server → Client message kinds

| Kind                 | Required fields                          | `data` shape         | Trigger                                                         | State mutation | Notes                                                                                                          |
| -------------------- | ---------------------------------------- | -------------------- | --------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------- |
| `state`              | `kind`, `data`                           | `State`              | Sent immediately on `open` and after successful state mutations | none           | Includes `protocolVersion: "1.1"`.                                                                             |
| `success`            | `kind`, `methodId`, `methodName`         | `unknown` (optional) | Successful completion of a client request                       | none           | `data` is only present for `get` responses.                                                                    |
| `error`              | `kind`, `methodId`, `methodName`, `data` | `string`             | Failed/invalid client request or thrown error                   | none           | `data` is a structured error code string (e.g. `INVALID_JSON: ...`).                                           |
| `fancontrolactivity` | `kind`, `data`                           | `FanControlActivity` | Published when telemetry updates                                | none           | Only delivered to sockets that subscribed with `registeractivitysocket`. Fixed mode still publishes telemetry. |

## Data shapes

```ts
type FanTable = [number, number][];

type Args = { [key: string]: number };

type FanControlActivity = {
  appliedSpeed: number | null;
  avgCPUTemp: number;
  avgGPUTemp: number;
  target: number;
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
