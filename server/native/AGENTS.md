# Native Platform Abstraction

## OVERVIEW

Platform-specific ACPI/WMI hardware interface. Abstracts fan speed reading/writing, temperature sensors, CPU power limits, and GPU boost control.

## STRUCTURE

```
native/
├── index.ts       # Platform detection, exports unified interface
├── index.test.ts  # Call serialization and initialization tests
├── linux/         # acpi_call kernel module interface
│   ├── acpi.ts    # Reads/writes via /proc/acpi/call
│   ├── acpi.test.ts # Linux ACPI unit tests
│   ├── cpuoc.ts   # CPU power limits via sysfs (intel-rapl)
│   └── cpuoc.test.ts # Linux RAPL unit tests
└── windows/
    ├── acpi.ts    # WMI via bun:ffi (loads WmiDll.dll)
    ├── acpi.test.ts # Windows WMI FFI unit tests
    ├── cpuoc.ts   # Intel XTU integration via bun:ffi + NativeAOT
    ├── cpuoc.test.ts # Windows CPUOC FFI unit tests
    ├── hardware.ts / hardware.worker.ts # Independent WMI/XTU worker channels
    ├── wmidll/    # C++ WMI COM wrapper (WmiDll.dll)
    └── cpuoc-dotnet/ # NativeAOT CPU OC project
```

## WHERE TO LOOK

| Task             | Location                                                             |
| ---------------- | -------------------------------------------------------------------- |
| Unified API      | `index.ts` → `getCall`, `setCall`, `initNativeServices`              |
| Linux ACPI       | `linux/acpi.ts` → reads `/proc/acpi/call`                            |
| Windows WMI      | `windows/acpi.ts` → loads `WmiDll.dll` via `bun:ffi`                 |
| CPU power limits | `linux/cpuoc.ts` (sysfs intel-rapl) / `windows/cpuoc.ts` (Intel XTU) |

## CONVENTIONS

- **getCall**: Returns `Promise<NativeResult>` (`number | string`, both platforms). Packed results exceeding `Number.MAX_SAFE_INTEGER` use exact decimal strings. Linux returns `NaN` on failure; Windows throws. Sensor callers require finite numbers.
- **setCall**: Returns `Promise<void>`. Throws on failure (both platforms).
- **Error handling**: Windows throws on hardware failures. Linux `getCall` returns `NaN` (WebSocket layer sends `ACPI_ERROR`). Callers must handle both patterns.

## ANTI-PATTERNS

- **Never call Windows modules on Linux**: Always guard with `process.platform`
- **No inline native code**: WmiDll.dll built separately with `cl.exe`, CPUOC.dll with NativeAOT

## NOTES

- Linux requires `acpi_call` kernel module loaded
- Windows requires admin rights for WMI access
- WmiDll uses C++ COM (`wbemcli.h`) — compiled with MSVC (`cl.exe`), loaded via `bun:ffi`
- WmiDll ABI 2 exports: `wmi_abi_version`, `wmi_init`, `wmi_get`, `wmi_get_named`, `wmi_set`, `wmi_set_named`, `wmi_cleanup`, `wmi_get_last_error` (the `*_named` variants transport full argument maps as VT_UI1; getter results are canonical little-endian bytes)
- CPUOC uses NativeAOT (.NET 8) — loaded via `bun:ffi`
- Each Windows library runs on its own owning worker thread. CPU tuning never blocks WMI. A fatal deadline permanently disables the affected channel and publishes `restartRequired`; do not reinitialize after an uncertain operation.
- NativeAOT libraries cannot be unloaded. Keep CPUOC.dll and its unreferenced worker rooted until process exit; never call `lib.close()` or terminate the CPU worker.
- Compiled builds include `native/windows/hardware.worker.ts` as an additional entry point; the bundled worker path is `native/windows/hardware.worker.js`.
- Build commands in `server/package.json` (`build:cpuoc`, `build:wmidll`)
- Native packing tests: `g++ -std=c++17 -Wall -Wextra -Werror server/native/windows/wmidll/WmiOutput.test.cpp -o /tmp/alfc-wmi-output-test && /tmp/alfc-wmi-output-test` from the repository root.
- CPUOC export tests: `dotnet run --project server/native/windows/cpuoc-dotnet/CPUOC.Tests.csproj` (uses a deterministic SDK substitute; actual production SDK compatibility still requires the Windows build).
