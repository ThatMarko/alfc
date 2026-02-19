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
    ├── acpi.ts    # WMI via helper process (stdin/stdout JSON IPC)
    ├── cpuoc.ts   # Intel XTU integration via bun:ffi + NativeAOT
    ├── wmiapi/    # .NET Framework 4.8 WMI helper (spawned as subprocess)
    └── cpuoc-dotnet/ # NativeAOT CPU OC project
```

## WHERE TO LOOK

| Task             | Location                                                        |
| ---------------- | --------------------------------------------------------------- |
| Unified API      | `index.ts` → `getCall`, `setCall`, `initNativeServices`         |
| Linux ACPI       | `linux/acpi.ts` → reads `/proc/acpi/call`                       |
| Windows WMI      | `windows/acpi.ts` → spawns `WmiAPI.exe`, JSON over stdin/stdout |
| CPU power limits | `windows/cpuoc.ts` (Windows only, Intel XTU)                    |

## CONVENTIONS

- **getCall**: Returns `Promise<number>` (both platforms). Linux returns `NaN` on failure; Windows throws.
- **setCall**: Returns `Promise<void>`. Throws on failure (both platforms).
- **Error handling**: Windows throws on hardware failures. Linux `getCall` returns `NaN` (WebSocket layer sends `ACPI_ERROR`). Callers must handle both patterns.

## ANTI-PATTERNS

- **Never call Windows modules on Linux**: Always guard with `os.platform()`
- **No inline .NET code**: WmiAPI.exe built separately with `dotnet publish`, CPUOC.dll with NativeAOT

## NOTES

- Linux requires `acpi_call` kernel module loaded
- Windows requires admin rights for WMI access
- WmiAPI uses .NET Framework 4.8 (built into Windows 11) — no runtime bundling needed
- WmiAPI has a 30-second stdin watchdog — self-terminates if parent process is gone
- CPUOC uses NativeAOT (.NET 8) — loaded via `bun:ffi`
- Build commands in `server/package.json` (`build:cpuoc`, `build:wmiapi`)
