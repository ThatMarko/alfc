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
    ├── acpi.ts    # WMI via bun:ffi + NativeAOT
    ├── cpuoc.ts   # Intel XTU integration
    ├── wmiapi/    # NativeAOT WMI project
    └── cpuoc-dotnet/ # NativeAOT CPU OC project
```

## WHERE TO LOOK

| Task             | Location                                                |
| ---------------- | ------------------------------------------------------- |
| Unified API      | `index.ts` → `getCall`, `setCall`, `initNativeServices` |
| Linux ACPI       | `linux/acpi.ts` → reads `/proc/acpi/call`               |
| Windows WMI      | `windows/acpi.ts` → calls `WmiAPI.dll` via bun:ffi      |
| CPU power limits | `windows/cpuoc.ts` (Windows only, Intel XTU)            |

## CONVENTIONS

- **getCall/setCall**: Returns string (hex for Linux, parsed for Windows)
- **Error handling**: Throws on hardware failures, caller must handle

## ANTI-PATTERNS

- **Never call Windows modules on Linux**: Always guard with `os.platform()`
- **No inline .NET code**: DLLs precompiled, rebuild with `dotnet publish`

## NOTES

- TODO exists: hex string → number conversion needed in both acpi.ts files
- Linux requires `acpi_call` kernel module loaded
- Windows requires admin rights for WMI access
- DLL rebuild commands in `server/package.json` (`build:cpuoc`, `build:wmiapi`)
