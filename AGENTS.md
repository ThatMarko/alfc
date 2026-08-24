# ALFC - Aorus Laptop Fan Control

**Generated:** 2026-02-18
**Commit:** 5bd77bb
**Branch:** master

## OVERVIEW

Cross-platform fan control utility for Aorus laptops. Web UI (React) + Bun backend with platform-specific native bindings. KDE Plasma 6 widget for Linux desktop integration (panel, system tray, desktop widget).

## STRUCTURE

```
alfc/
├── bootstrap/       # Service management (install/uninstall/run)
├── common/          # Shared TypeScript types + protocol docs
├── frontend/        # React web UI (Vite, @emotion/react)
├── plasmoid/        # KDE Plasma 6 widget (QML)
│   └── package/contents/ui/  # 11 pure QML files: main, compact, full, backend, fan editor, config, settings, metric tile, section card, heading, inline msg
├── server/          # Bun backend
│   ├── fan-control/ # Core fan logic + tests
│   ├── native/      # Platform-specific (linux/windows)
│   │   ├── wmiapi/  # Windows WMI helper (.NET Framework 4.8)
│   │   └── cpuoc-dotnet/ # Windows CPU OC NativeAOT
│   ├── state/       # Config persistence
│   └── websocket/   # Client communication + tests
└── assets/          # Static resources
```

## WHERE TO LOOK

| Task              | Location                                | Notes                                                                                |
| ----------------- | --------------------------------------- | ------------------------------------------------------------------------------------ |
| Fan curve logic   | `server/fan-control/`                   | Ramping prevents frequent fluctuations                                               |
| ACPI/WMI calls    | `server/native/{linux,windows}/acpi.ts` | Platform abstraction (Linux: /proc/acpi, Windows: WmiAPI.exe subprocess)             |
| Frontend state    | `frontend/src/utils/useWebSocket.ts`    | WebSocket hook for real-time updates                                                 |
| Frontend tests    | `frontend/src/{data,utils}/*.test.ts`   | MOF parser tests, toast utility tests                                                |
| Shared types      | `common/types.ts`                       | `State`, `MessageToServer`, `MessageToClient`                                        |
| Service lifecycle | `bootstrap/scripts/linux/*.sh`          | Linux: auto-detects systemd or OpenRC                                                |
| KDE Plasma widget | `plasmoid/package/contents/ui/`         | Multi-context: panel (text), system tray (icon), desktop (full), tooltip (mini-dash) |
| Config schema     | `alfc.config.json`                      | Fan tables, PL1/PL2 limits                                                           |

## CONVENTIONS

- **Monorepo**: Bun workspaces (`frontend`, `server`)
- **Bun 1.3+** required (1.4+ recommended)
- **ESM imports**: Extensionless relative imports (Bun `moduleResolution: "bundler"` convention). Use `node:` prefix for Node built-in modules.
- **No explicit `any`**: ESLint warns on `@typescript-eslint/no-explicit-any`. One known exception in `common/types.ts` (protocol data field).
- **Underscore prefix**: Unused vars must use `_` prefix
- **Strict TypeScript**: `strict: true` + `noUncheckedIndexedAccess: true` — always handle potential `undefined` from indexed access
- **Accessibility**: Frontend uses `aria-label` on all interactive elements. Plasmoid uses `Accessible.role` / `Accessible.name`.
- **i18n (QML)**: All user-visible strings wrapped in `i18n()` for KDE translation framework

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
bun run lint              # ESLint (0 errors required, warnings OK)
bun run type-check        # TypeScript (no emit, strict + noUncheckedIndexedAccess)
bun run test              # Vitest (38 tests: server + frontend)

# Windows Native Build
cd server/native/wmiapi && dotnet publish -c Release
cd server/native/cpuoc-dotnet && dotnet publish -c Release -r win-x64

# Service Management (Linux)
sudo ./install.sh         # Install to /opt/alfc as system service
sudo /opt/alfc/uninstall.sh  # Remove service and installed files

# Plasmoid
kpackagetool6 --type Plasma/Applet --install plasmoid/package    # Install
kpackagetool6 --type Plasma/Applet --upgrade plasmoid/package    # Upgrade
plasmoidviewer -a plasmoid/package                               # Dev preview
```

## NOTES

- Exit handler restores BIOS automatic fan control (disables fixed mode, re-enables auto mode)
- Linux release is a Bun-compiled executable with systemd/OpenRC service scripts
- Windows release is a Bun-compiled executable with WinSW service wrapper
- Windows logging: WinSW to `service.log` (systemd journal / OpenRC stdout for Linux)
- Windows WMI: `WmiAPI.exe` subprocess (.NET Framework 4.8, built into Windows 11) communicates via stdin/stdout JSON, 30s stdin watchdog
- Windows CPU OC: `bun:ffi` loads NativeAOT DLL (requires .NET 8 SDK to build)
- Windows service: WinSW with `stopParentFirst` + `stopTimeout=15s` for safe fan restore on shutdown
- Bootstrap: Scripts-only (no TypeScript), WinSW replaces `os-service`
- CI: GitHub Actions on master, runs `bun run all-checks`
- Release: GitHub Actions on `v*` tag, builds Linux + Windows + plasmoid
- Pre-commit: Husky + lint-staged runs ESLint, type-check, Prettier on staged files
