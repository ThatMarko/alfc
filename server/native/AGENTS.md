# Native Platform Abstraction

## OVERVIEW

Platform-specific ACPI/WMI hardware interface. Abstracts fan speed reading/writing, temperature sensors, CPU power limits, and GPU boost control.

## STRUCTURE

```
native/
├── index.ts       # Platform detection, exports unified interface
├── linux/         # acpi_call kernel module interface
│   ├── acpi.ts    # Reads/writes via /proc/acpi/call
│   └── cpuoc.ts   # CPU power limits via sysfs (intel-rapl)
└── windows/
    ├── acpi.ts    # WMI via bun:ffi (loads WmiDll.dll)
    ├── cpuoc.ts   # Intel XTU integration via bun:ffi + NativeAOT
    ├── wmidll/    # C++ WMI COM wrapper (WmiDll.dll)
    └── cpuoc-dotnet/ # NativeAOT CPU OC project
```

## WHERE TO LOOK

| Task             | Location                                                |
| ---------------- | ------------------------------------------------------- |
| Unified API      | `index.ts` → `getCall`, `setCall`, `initNativeServices` |
| Linux ACPI       | `linux/acpi.ts` → reads `/proc/acpi/call`               |
| Windows WMI      | `windows/acpi.ts` → loads `WmiDll.dll` via `bun:ffi`    |
| CPU power limits | `windows/cpuoc.ts` (Windows only, Intel XTU)            |

## CONVENTIONS

- **getCall**: Returns `Promise<number>` (both platforms). Linux returns `NaN` on failure; Windows throws.
- **setCall**: Returns `Promise<void>`. Throws on failure (both platforms).
- **Error handling**: Windows throws on hardware failures. Linux `getCall` returns `NaN` (WebSocket layer sends `ACPI_ERROR`). Callers must handle both patterns.

## ANTI-PATTERNS

- **Never call Windows modules on Linux**: Always guard with `os.platform()`
- **No inline native code**: WmiDll.dll built separately with `cl.exe`, CPUOC.dll with NativeAOT

## NOTES

- Linux requires `acpi_call` kernel module loaded
- Windows requires admin rights for WMI access
- WmiDll uses C++ COM (`wbemcli.h`) — compiled with MSVC (`cl.exe`), loaded via `bun:ffi`
- WmiDll exports: `wmi_init`, `wmi_get`, `wmi_set`, `wmi_cleanup`, `wmi_get_last_error`
- CPUOC uses NativeAOT (.NET 8) — loaded via `bun:ffi`
- Build commands in `server/package.json` (`build:cpuoc`, `build:wmidll`)
