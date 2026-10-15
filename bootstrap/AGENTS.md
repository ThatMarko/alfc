# Service bootstrap

Bootstrap contains service scripts, not a TypeScript application. The release
assembly copies these scripts beside the compiled executable and production assets.
Do not run install/uninstall against the development host during verification.

| File                                                 | Purpose                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------- |
| `scripts/install.bat`, `uninstall.bat`, `run.bat`    | Windows install/remove/foreground entry points                      |
| `scripts/alfc-service.xml`                           | WinSW v2.12 x64 wrapper configuration                               |
| `scripts/linux/install.sh`, `uninstall.sh`, `run.sh` | Linux service management and foreground execution                   |
| `scripts/linux/alfc.service`                         | Shared systemd template; AUR substitutes its installation directory |
| `scripts.test.ts`                                    | Isolated script execution and wrapper shutdown regression checks    |

## Safety and lifecycle

The service name is `alfc`. Windows scripts check effective administrator
membership using `WindowsPrincipal`, then request UAC elevation only when needed.
Pass script paths through an environment variable; embedding a path inside a
PowerShell quoted literal breaks directories containing apostrophes. Wait for the
elevated process and return its exit status. Do not use `net session`, which also
depends on an unrelated Windows service.
Keep the elevation request at top level; a successful administrator check jumps
past it. Immediately capture the PowerShell result in `ALFC_ELEVATION_STATUS`
and pass that explicit code to `exit /b`. Windows runtime fixtures confirmed that
implicit `exit /b` hid the delegated failure behind a successful `cmd /c` process
result even after moving the request outside its original parenthesized branch.

Use `alfc-service.exe stopwait` before uninstalling or reinstalling a Windows
service, and abort on failure. In the pinned WinSW v2.12 wrapper, `stop` only
requests shutdown and returns before the service reaches `Stopped`; immediate
uninstallation can leave the service marked for deletion and race replacement.
Keep the existing-service installer path outside a parenthesized `if` block so
failure exits propagate through `cmd /c`; use the fresh-install label to skip it
when SCM reports no existing service. Windows fixtures check the process exit
status as well as the command order.

WinSW XML names are case-sensitive. The pinned
[v2.12.0 parser](https://github.com/winsw/winsw/blob/v2.12.0/src/WinSW.Core/Configuration/XmlServiceConfig.cs)
uses lowercase `workingdirectory`, `stopparentprocessfirst`, and `stoptimeout`,
but mixed-case `delayedAutoStart`, `sizeThreshold`, and `keepFiles`. Preserve each
name's exact spelling, including attribute names. The stop timeout is 15 seconds
so the backend's 12-second bounded BIOS handoff can finish. WinSW first sends
Ctrl+C, then forcibly terminates processes that do not stop. Never describe this
as a guarantee that unresponsive firmware restored successfully. Windows logs
roll beside the wrapper.

The manual Linux installation directory is `/opt/alfc`; the command symlink is
`/usr/bin/alfc`. Preflight required release files and init support before changing
files. A foreign command symlink must not be overwritten or removed. Stop an
existing service successfully before overwriting or deleting its files. Preserve
`alfc.config.json` on upgrade and ordinary uninstall; `--purge` deletes it.
Reject a foreign `/usr/bin/alfc` command before uninstalling as well: the service
name is shared with package installations, so preserving that symlink alone does
not establish ownership of the service.
The installer fixes the owned installation directory and optional desktop
resource permissions so a restrictive root umask cannot block unprivileged
Plasma/Omarchy installation. Retain existing configuration bytes and mode.

systemd uses `TimeoutStopSec=15s` and journal logging. OpenRC uses
`retry="TERM/15/KILL/5"`, requires local mounts, and orders after module loading;
it does not require external networking. Its background mode currently does not
configure an output log, so use `run.sh` for foreground diagnostics. Unknown init
systems fail before mutation; do not fall back to `killall`.

## Verification

Run `bunx vitest run bootstrap/scripts.test.ts` with the repository toolchain.
Linux script tests rebase every privileged filesystem target into a temporary
directory and replace service commands. They verify fresh installation, upgrade,
config preservation, explicit purge, obsolete asset removal, failed stop/restart
reporting, conflicting-installation refusal before service access, and tar layout.
Windows also runs the real batch entrypoints against disposable compiled command
substitutes for administrator detection, SCM queries, and WinSW. These verify
fresh installation, shutdown ordering, and failed-stop/removal aborts without elevation or host service access;
they skip on other platforms. Actual UAC, SCM, and WinSW integration still require
Windows runtime validation. Shell syntax and unit-template verification are useful
additional checks, and must not start host services.
