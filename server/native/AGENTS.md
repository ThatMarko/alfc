# Native Platform Abstraction

## Scope and files

`index.ts` is the application boundary for elevated Linux and Windows hardware operations. Application code must use this boundary; importing a Windows FFI adapter directly on the server event loop bypasses worker isolation and can freeze telemetry or shutdown.

| Files                                                        | Responsibility                                                                                                                                                    |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`, `index.test.ts`                                  | Platform selection, independent fan/CPU queues, capability initialization, fatal failure publication, shutdown drain; tests explicitly exercise Linux and Windows |
| `linux/acpi.ts`, `linux/acpi.test.ts`                        | Serialized `/proc/acpi/call` request/result transport and canonical MOF argument packing                                                                          |
| `linux/cpuoc.ts`, `linux/cpuoc.test.ts`                      | Intel package RAPL discovery, watt conversion, verified application and rollback                                                                                  |
| `windows/hardware.ts`, `windows/hardware.test.ts`            | Two lazy worker channels, correlated RPC, deadlines, close/error handling and process-lifetime CPU worker retention                                               |
| `windows/hardware-protocol.ts`, `windows/hardware.worker.ts` | Internal typed RPC and sequential execution on each worker's owning thread                                                                                        |
| `windows/acpi.ts`, `windows/acpi.test.ts`                    | WmiDll ABI declaration, named arguments, rooted FFI buffers, byte decoding and COM adapter lifecycle                                                              |
| `windows/wmidll/`                                            | MSVC-built C++ WMI COM implementation, output packing, portable packing tests and Windows COM tests                                                               |
| `windows/cpuoc.ts`, `windows/cpuoc.test.ts`                  | Optional CPUOC FFI prototype, initialization, native error ownership and permanent rollback failure handling                                                      |
| `windows/cpuoc-dotnet/`                                      | Experimental NativeAOT exports and executable tests using an SDK substitute                                                                                       |
| `windows/IntelOverclockingSDK.dll`                           | Proprietary managed SDK dependency; its presence does not establish a complete or working NativeAOT dependency graph                                              |

## Public API and data contract

- `getCall(methodId, methodName, args?)` returns `Promise<NativeResult>`. Both adapters validate the method ID/name and complete named input signature against [`common/methods.ts`](../../common/methods.ts). Decimal and hexadecimal IDs identify the same canonical method.
- `NativeResult` is `number | string`: ordinary exact results remain numeric; packed values above `Number.MAX_SAFE_INTEGER` use exact decimal strings. `GetDeepFan` can contain ten bytes, so converting every response through `Number` loses data. Sensor consumers must require finite numeric values.
- Output bytes follow the declared method parameter order, with each `uint16` occupying two little-endian bytes even below 256. Windows verifies native byte counts; Linux verifies buffer lengths and integer ranges against the same MOF widths.
- Linux getter failures return `NaN`; Windows getters throw. Setters throw on either platform. The WebSocket layer translates these into the documented protocol errors; callers must handle both getter failure patterns.
- `setCall(methodId, methodName, args)` returns `Promise<void>` after the platform acknowledges the call. This does not prove a mechanical fan reached its requested RPM. A Linux write succeeding is insufficient: read `/proc/acpi/call` and reject firmware `Error:` responses.
- `tune(pl1 = state.pl1, pl2 = state.pl2)` captures both values at invocation and returns `Promise<void>`. Limits are integer watts from 0 to 200. Both platform implementations verify readback and attempt to restore both previous limits after partial failure.
- An unverifiable CPU rollback permanently disables tuning for that process and carries `restartRequired: true`. The abstraction publishes `isCpuTuningAvailable: false` and `state.restartRequired: true`. Unaffected fan/GPU features remain usable.
- `initNativeServices(shouldStop?)` probes the platform backend, initializes managed fan control, initializes/tunes the independent CPU backend, and probes GPU boost. A failed managed fan initialization permits independent CPU/GPU startup only after a successful BIOS handoff; a failed handoff rejects startup so shutdown can retry restoration. Check shutdown after every awaited phase and before starting another mutation.
- `drainNativeCalls()` intentionally drains the ACPI/WMI queue only. Optional CPU work must not consume the BIOS fan restoration budget.
- `cleanupNativeServices()` rejects new operations, drains ACPI/WMI, cleans WMI on its owning thread, and closes the CPU parent channel without unloading NativeAOT. CPU operations still queued in the abstraction must reject after cleanup; active native calls cannot be safely cancelled by rejecting their parent promises.

## Linux transport and RAPL

Fan control requires the `acpi_call` kernel module and the firmware namespace `\_SB.PCI0.AMW0.WMBC` / `WMBD`. Availability is cached for the process; loading the module after a failed startup requires restarting ALFC. `/proc/acpi/call` is one shared request/result channel, so do not run independent diagnostics against it while ALFC is active.

Input fields are packed in canonical MOF declaration order, rather than JSON insertion order. Current input fields are all `uint8`; adding another type requires updating both native transports, not merely the frontend form. Accept only complete integer/buffer results. Reject error text, stale `not called` results, malformed/truncated buffers and out-of-range output values.

The Linux input transport uses one ACPI integer and supports at most eight
`uint8` fields on both supported 64-bit targets. Reject wider signatures before
writing `/proc/acpi/call`: the [pinned upstream parser](https://github.com/nix-community/acpi_call/blob/6ad1e676dbfb5dcb1ec1f973c10ef5c57ffb4069/acpi_call.c#L269-L274)
uses `simple_strtol` and cannot preserve an 80-bit packed value. In particular,
the catalog's ten-byte `SetDeepFan` signature is unavailable through this Linux
transport; the managed WebSocket fan-method guard already blocks that raw
setter independently. Preserve all eight-byte input bit patterns, including a
set high bit. This input limit does not constrain buffer outputs such as the
ten-byte `GetDeepFan`, or Windows' named WMI arguments. Do not substitute an ACPI
buffer argument without establishing firmware compatibility separately.

Normalize validated hexadecimal method IDs to lowercase before sending them to
`acpi_call`. Its [argument parser](https://github.com/nix-community/acpi_call/blob/master/acpi_call.c)
checks a literal lowercase `0x` prefix; forwarding an accepted uppercase `0X`
prefix would select decimal parsing and dispatch method zero. WebSocket callers
already use catalog IDs, but the native boundary must honor the same accepted
numeric ID forms independently.

RAPL checks package zero in these locations, in order:

1. `/sys/devices/virtual/powercap/intel-rapl/intel-rapl:0`
2. `/sys/class/powercap/intel-rapl:0`
3. `/sys/class/powercap/intel-rapl-mmio:0`

Resolve `constraint_0` / `constraint_1` through their optional `long_term` and `short_term` names; use legacy index ordering only when both names are absent. Sysfs power values are microwatts. Missing constraints, unsupported hardware, permission errors, clamping and failed restoration must not produce a success acknowledgement. This implementation targets a single Intel laptop CPU package; it is not a general multi-package power manager.

Intel package zones expose an independent `enabled` attribute. Require a readable value of `1` during discovery, before writes, and when verifying application or rollback. Matching power-limit readbacks alone do not establish that PL1 enforcement is enabled. Never enable a zone implicitly; a disabled, missing or unreadable enable state rejects tuning, and an unverifiable rollback retains the permanent restart requirement.

## Windows workers and FFI ownership

The application creates separate WMI and CPU worker instances from the same `hardware.worker.ts` entry point. A stalled optional XTU operation must neither block WMI's queue nor terminate its worker. Each worker serializes its own RPC operations. Keep imports in the worker free of top-level `await` before its message handler is installed; Bun can otherwise drop early messages.

Bun's main-thread watchdogs bound WMI initialization to 20 seconds, ordinary calls to 5 seconds, and WMI cleanup to 2 seconds. WmiDll additionally uses a 3-second semisynchronous method deadline. These are failure detection bounds, not cancellation guarantees. WMI initialization makes up to three attempts with 2-second backoff, unless a fatal timeout or shutdown stops it first. A JavaScript `Promise.race` around synchronous main-thread FFI cannot enforce a deadline.

An unexpected worker `close` or `error`, a parent watchdog expiry, or a native permanent failure poisons that channel. Reject outstanding requests and future calls; never create a replacement worker or retry an operation whose completion is uncertain. WMI failure publishes both fan/GPU capabilities as unavailable and stops future monitoring intervals. CPU failure downgrades CPU capability only. Both publish `restartRequired` for connected and newly connecting clients.

Windows native release builds require the x64 MSVC target. WmiDll rejects fractional/coerced numeric values and malformed parameter IDs; completion-status transport failures also poison the channel because the hardware outcome is unknown.

WmiDll ABI **2** exports `wmi_abi_version`, `wmi_init`, `wmi_get`, `wmi_get_named`, `wmi_set`, `wmi_set_named`, `wmi_cleanup` and `wmi_get_last_error`. Rebuild the DLL whenever its ABI changes. The result buffer is a `Float64Array` whose elements contain canonical bytes, not one double per original WMI output field. Keep argument/result buffers and cached method-name buffers rooted until the synchronous call returns. Never close the DLL while a native call is active or call COM cleanup from another thread.

The WMI error string belongs to the DLL; copy it without freeing it. CPUOC error strings are allocated with `CoTaskMem` and must be copied then freed with `cpuoc_free_string`, including exceptional paths. Bun `CString` copies the string contents.

.NET explicitly does **not** support unloading NativeAOT libraries through `FreeLibrary` / `dlclose`. Do not call `lib.close()` for CPUOC or terminate its CPU worker during normal cleanup or timeout handling. Retain the handle/worker, reject further parent requests and `unref()` the worker so the process can exit. Process exit is the lifetime boundary.

Compiled Windows builds must include `native/windows/hardware.worker.ts` as an additional Bun entry point. Its embedded path is `native/windows/hardware.worker.js`; source mode resolves the worker beside `hardware.ts`. In compiled executables, DLLs are external files beside `process.execPath`. Running source with `NODE_ENV=production` still uses the source paths; production mode does not imply compilation. Source mode uses `windows/wmidll/WmiDll.dll` and `windows/CPUOC.dll`.

## CPUOC prototype limits

Windows release archives ship WmiDll and **do not** ship CPUOC or the proprietary Intel SDK. CPU tuning is unavailable unless a separately validated compatible DLL is supplied. The current NativeAOT project is an experimental prototype, not a supported way to produce a working XTU backend from this checkout alone.

The bundled Intel SDK 6.5 is a .NET Framework assembly using WCF and other dependencies absent from the checkout. Compiling the managed wrapper against its API proves signatures; SDK-substitute tests prove wrapper control flow. Neither proves NativeAOT compatibility or communication with a real XTU service. Default publishing is intentionally blocked. A dependency investigation can explicitly opt in with `-p:AllowExperimentalCpuocPublish=true`; that flag does not repair missing dependencies, unsupported runtime APIs or cross-OS NativeAOT compilation.

## Validation

From the repository root:

```bash
bun x vitest run server/native
bun run --cwd server type-check
bun x eslint server/native
c++ -std=c++17 -Wall -Wextra -Werror server/native/windows/wmidll/WmiOutput.test.cpp -o /tmp/alfc-wmi-output-test
/tmp/alfc-wmi-output-test
dotnet run --project server/native/windows/cpuoc-dotnet/CPUOC.Tests.csproj
```

On Windows with the MSVC developer environment, run `bun run --cwd server build:wmidll`, then build/run `WmiNative.test.cpp` from `windows/wmidll` with `cl /nologo /EHsc WmiNative.test.cpp /link ole32.lib oleaut32.lib wbemuuid.lib`. These tests exercise COM invocation using deterministic substitutes, not laptop firmware. Do not run the adapter debug entry points during CI: they attempt real hardware initialization when native DLLs are present.

Unit tests, cross-compilation, managed API compilation, source/compiled worker smoke tests and substitute SDK/COM tests establish distinct properties. Report which ran. Firmware compatibility, privileges, installed XTU service behavior, actual fan RPM, thermal behavior and power-limit readback require a supported physical laptop. Bun FFI and worker termination remain experimental upstream APIs; preserve process-lifetime and timeout safeguards when upgrading Bun.

## Authoritative references

- [Bun workers: early messages, close events and lifetime](https://bun.com/docs/runtime/workers)
- [Bun standalone executables: additional worker entry points](https://bun.com/docs/bundler/executables#worker)
- [Bun FFI and string/pointer ownership](https://bun.com/docs/runtime/ffi)
- [acpi_call request/result syntax](https://github.com/mkottman/acpi_call)
- [Linux powercap attributes and units](https://docs.kernel.org/power/powercap/powercap.html)
- [Linux powercap sysfs ABI](https://www.kernel.org/doc/Documentation/ABI/testing/sysfs-class-powercap)
- [Intel RAPL enable and power-limit operations](https://github.com/torvalds/linux/blob/master/drivers/powercap/intel_rapl_common.c)
- [Microsoft WMI semisynchronous methods](https://learn.microsoft.com/en-us/windows/win32/api/wbemcli/nf-wbemcli-iwbemservices-execmethod)
- [.NET NativeAOT shared library limitations](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/libraries)
