# ALFC - Aorus Laptop Fan Control

**Generated:** 2026-02-13
**Commit:** 11e834f
**Branch:** master

## OVERVIEW

Cross-platform fan control utility for Aorus laptops. Web UI (React) + Bun backend for Linux with platform-specific native bindings.

## STRUCTURE

```
alfc/
├── bootstrap/       # Service management (install/uninstall/run)
├── common/          # Shared TypeScript types
├── frontend/        # React web UI (Vite)
├── server/          # Node.js backend
│   ├── fan-control/ # Core fan logic
│   ├── native/      # Platform-specific (linux/windows)
│   │   ├── wmiapi/  # Windows WMI NativeAOT
│   │   └── cpuoc-dotnet/ # Windows CPU OC NativeAOT
│   ├── state/       # Config persistence
│   └── websocket/   # Client communication
└── assets/          # Static resources
```

## WHERE TO LOOK

| Task              | Location                                | Notes                                                                  |
| ----------------- | --------------------------------------- | ---------------------------------------------------------------------- |
| Fan curve logic   | `server/fan-control/`                   | Ramping prevents frequent fluctuations                                 |
| ACPI/WMI calls    | `server/native/{linux,windows}/acpi.ts` | Platform abstraction (Linux: /proc/acpi, Windows: bun:ffi + NativeAOT) |
| Frontend state    | `frontend/src/utils/useWebSocket.ts`    | WebSocket hook for real-time updates                                   |
| Shared types      | `common/types.ts`                       | `State`, `MessageToServer`, `MessageToClient`                          |
| Service lifecycle | `bootstrap/scripts/linux/*.sh`          | Linux uses systemd service scripts                                     |
| Config schema     | `alfc.config.json`                      | Fan tables, PL1/PL2 limits                                             |

## CONVENTIONS

- **Monorepo**: Bun workspaces (`frontend`, `server`)
- **Bun 1.3+** required
- **ESM imports**: Use `.js` extension even for `.ts` files
- **No explicit `any`**: ESLint allows but prefer avoiding
- **Underscore prefix**: Unused vars must use `_` prefix

## ANTI-PATTERNS (THIS PROJECT)

- **No Makefiles/Docker**: Build via `bun run build`, not containers
- **No separate test dirs**: Tests colocated as `*.test.ts`
- **Never run without elevation**: Server exits if not elevated

## UNIQUE STYLES

- Frontend -> Server args: NOT hex strings (WMI uses named args)
- Fan speeds unified: Both fans get highest target (shared heat pipes)
- Windows 15s startup delay: Waits for WMI service availability

## COMMANDS

```bash
# Development
sudo bun run start        # Frontend at :3000, server at :5522

# Build & Check
bun run build             # Build all packages
bun run all-checks        # Lint + type-check + test + build
bun run lint              # ESLint
bun run type-check        # TypeScript (no emit)
bun run test              # Vitest

# Windows NativeAOT Build
cd server/native/wmiapi && dotnet publish -c Release -r win-x64
cd server/native/cpuoc-dotnet && dotnet publish -c Release -r win-x64

# Service Management (Linux)
sudo ./install.sh         # Install as system service
sudo ./uninstall.sh       # Remove service
```

## NOTES

- Exit handler sets fans to 100% to prevent overheating
- Linux release is a Bun-compiled executable with systemd scripts
- Windows release is a Bun-compiled executable with WinSW service wrapper
- Windows logging: WinSW to `service.log` (systemd handles Linux)
- Windows native: `bun:ffi` loads NativeAOT DLLs (replaces `edge-js`)
- Bootstrap: Scripts-only (no TypeScript), WinSW replaces `os-service`
- Windows build requires .NET 8 SDK
- CI: GitHub Actions on master, runs `bun run all-checks`
