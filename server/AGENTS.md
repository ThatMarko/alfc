# Server Package

## OVERVIEW

Bun backend handling fan control logic, ACPI/WMI hardware calls, WebSocket communication, and static file serving (production).

## STRUCTURE

```
server/
├── fan-control/   # Fan speed calculation, auto-ramping
├── native/        # Platform abstraction (→ see native/AGENTS.md)
├── state/         # Config file read/write
├── utils/         # Constants (isDev, etc.)
├── websocket/     # Client message handling
├── build.ts       # Bun compile config (cross-platform executable)
└── index.ts       # Entry point (Bun.serve + WebSocket)
```

## WHERE TO LOOK

| Task               | Location                                       |
| ------------------ | ---------------------------------------------- |
| Fan calculation    | `fan-control/index.ts`                         |
| Fan control tests  | `fan-control/index.test.ts`                    |
| WS contract tests  | `websocket/index.test.ts`                      |
| ACPI calls         | `native/index.ts` → delegates to linux/windows |
| Config persistence | `state/index.ts`                               |
| WS message types   | `../common/types.ts`                           |

## CONVENTIONS

- **Entry requires elevation**: Exits with error if not root/admin
- **Exit handler**: Restores BIOS automatic fan control (disables fixed mode, re-enables auto mode)
- **Linux build output**: Bun-compiled executable (`dist/alfc`)
- **Windows build output**: Bun-compiled executable (`dist/alfc.exe`)

## ANTI-PATTERNS

- **Never suppress type errors**: No `as any` on native module boundaries
- **Never assume platform**: Always check `os.platform()` before native calls

## NOTES

- Port 5522 hardcoded
- Dev server uses `bun --watch index.ts`
