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

WinSW XML names are case-sensitive. The pinned v2.12 configuration uses
`workingdirectory`, `stopparentprocessfirst`, and `stoptimeout`; the latter is 15 seconds so the backend's
12-second bounded BIOS handoff can finish. WinSW first sends Ctrl+C, then forcibly
terminates processes that do not stop. Never describe this as a guarantee that
unresponsive firmware restored successfully. Windows logs roll beside the wrapper.

The manual Linux installation directory is `/opt/alfc`; the command symlink is
`/usr/bin/alfc`. Preflight required release files and init support before changing
files. A foreign command symlink must not be overwritten or removed. Stop an
existing service successfully before overwriting or deleting its files. Preserve
`alfc.config.json` on upgrade and ordinary uninstall; `--purge` deletes it.

systemd uses `TimeoutStopSec=15s` and journal logging. OpenRC uses
`retry="TERM/15/KILL/5"`, requires local mounts, and orders after module loading;
it does not require external networking. Its background mode currently does not
configure an output log, so use `run.sh` for foreground diagnostics. Unknown init
systems fail before mutation; do not fall back to `killall`.

## Verification

Run `bunx vitest run bootstrap/scripts.test.ts` with the repository toolchain.
Linux script tests rebase every privileged filesystem target into a temporary
directory and replace service commands. They verify config preservation, obsolete
asset removal, failed-stop aborts, conflicting installations, and tar layout.
Windows runs the wrapper-configuration test; UAC, SCM, and WinSW integration still
require Windows runtime validation. Shell syntax and unit-template verification
are useful additional checks, and must not start host services.
