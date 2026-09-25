# Bootstrap Package

## OVERVIEW

OS service management: installs/uninstalls alfc as system service, handles service lifecycle.
Bootstrap is now scripts-only (no TypeScript). WinSW for Windows, shell scripts for Linux.

## WHERE TO LOOK

| Task                 | Location                                    |
| -------------------- | ------------------------------------------- |
| Service registration | WinSW (Windows) / systemd or OpenRC (Linux) |
| Sudo elevation       | Self-elevating batch scripts / sudo         |
| Platform scripts     | `scripts/linux/` and `scripts/*.bat`        |
| WinSW config         | `scripts/alfc-service.xml`                  |

## CONVENTIONS

- **Service name**: `alfc` (hardcoded)
- **Dependencies**: Windows needs `WinSW`, Linux needs `acpi_call`
- **Windows install.bat is idempotent**: Safely stops and removes existing service before installing

## NOTES

- Windows: Logs to `service.log` via WinSW
- Linux (systemd): Logs go to systemd journal
- Linux (OpenRC): Logs go to stdout (use `rc-service alfc start` to see output)
- Windows install.bat auto-opens browser to `localhost:5522`
- WinSW config: `stopParentFirst` ensures alfc.exe completes fan restore and COM cleanup before being killed
- WinSW config: `stopTimeout=15 sec` gives shutdown enough time for WMI restore commands
- WinSW config: `resetfailure=1 hour` prevents stale failure count from accumulating
