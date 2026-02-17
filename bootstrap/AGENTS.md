# Bootstrap Package

## OVERVIEW

OS service management: installs/uninstalls alfc as system service, handles service lifecycle.
Bootstrap is now scripts-only (no TypeScript). WinSW for Windows, shell scripts for Linux.

## WHERE TO LOOK

| Task                 | Location                                |
| -------------------- | --------------------------------------- |
| Service registration | WinSW (Windows) / systemd (Linux)       |
| Sudo elevation       | Self-elevating batch scripts / sudo     |
| Platform scripts     | `scripts/linux/` and `scripts/windows/` |
| WinSW config         | `scripts/alfc-service.xml`              |

## CONVENTIONS

- **Service name**: `alfc` (hardcoded)
- **Dependencies**: Windows needs `WinSW`, Linux needs `acpi_call`

## NOTES

- Windows: Logs to `service.log` via WinSW
- Linux: Logs go to systemd journal
- After install, auto-opens browser to `localhost:5522`
