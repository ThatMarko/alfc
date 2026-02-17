# ALFC - Aorus Laptop Fan Control

**Generated:** 2026-02-17
**Commit:** 3cb92b7
**Branch:** master

## OVERVIEW

Cross-platform fan control utility for Aorus laptops. Web UI (React) + Bun backend with platform-specific native bindings. KDE Plasma 6 widget for Linux desktop integration.

## STRUCTURE

```
alfc/
├── bootstrap/       # Service management (install/uninstall/run)
├── common/          # Shared TypeScript types + protocol docs
├── frontend/        # React web UI (Vite)
├── plasmoid/        # KDE Plasma 6 widget (QML)
├── server/          # Bun backend
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
| Service lifecycle | `bootstrap/scripts/linux/*.sh`          | Linux: auto-detects systemd or OpenRC                                  |
| KDE Plasma widget | `plasmoid/package/contents/ui/`         | QML-based Plasma 6 widget with WebSocket client                        |
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
- Windows WMI init: 3 retries with 2s delay between attempts

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
- Linux release is a Bun-compiled executable with systemd/OpenRC service scripts
- Windows release is a Bun-compiled executable with WinSW service wrapper
- Windows logging: WinSW to `service.log` (systemd journal / OpenRC stdout for Linux)
- Windows native: `bun:ffi` loads NativeAOT DLLs (replaces `edge-js`)
- Bootstrap: Scripts-only (no TypeScript), WinSW replaces `os-service`
- Windows build requires .NET 8 SDK
- CI: GitHub Actions on master, runs `bun run all-checks`
- Release: GitHub Actions on `v*` tag, builds Linux + Windows + plasmoid
