# Service bootstrap

Bootstrap contains service scripts, not a TypeScript application. The release
assembly copies these scripts beside the compiled executable and production assets.
Do not run install/uninstall against the development host during verification.

| File                                                 | Purpose                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------- |
| `scripts/install.bat`, `uninstall.bat`, `run.bat`    | Windows install/remove/foreground entry points                      |
| `scripts/alfc-service.xml`                           | WinSW v2.12 x64 wrapper configuration                               |
| `WinSW-LICENSE.txt`                                  | Exact upstream WinSW v2.12.0 copyright and permission notice        |
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

Windows must distinguish SCM query error 1060 (the service does not exist) from
access or query failures, which abort without changes. Before stop/removal,
verify the registered `ImagePath` names this exact quoted `alfc-service.exe` and
the local XML service ID is `alfc`. The pinned WinSW installer registers its own
fully qualified wrapper path in that quoted form; reject other executables,
wrapper arguments, ambiguous unquoted paths, and unavailable identity reads.
This also refuses reinstalling from a different extracted directory: use the
original directory's uninstaller, preserve its settings, and then install the
replacement. A same-directory reinstall and ordinary uninstall preserve the
configuration bytes. Repeated uninstall succeeds when SCM reports 1060 without
calling WinSW. Require the executable, wrapper, XML, WMI DLL, and frontend entry
file to be files before an installer can stop an existing service.

WinSW XML names are case-sensitive. The pinned
[v2.12.0 parser](https://github.com/winsw/winsw/blob/v2.12.0/src/WinSW.Core/Configuration/XmlServiceConfig.cs)
uses lowercase `workingdirectory`, `stopparentprocessfirst`, and `stoptimeout`,
but mixed-case `delayedAutoStart`, `sizeThreshold`, and `keepFiles`. Preserve each
name's exact spelling, including attribute names. The stop timeout is 15 seconds
so the backend's 12-second bounded BIOS handoff can finish. WinSW first sends
Ctrl+C, then forcibly terminates processes that do not stop. Never describe this
as a guarantee that unresponsive firmware restored successfully. Windows logs
roll beside the wrapper. Both Windows builders must stage the exact pinned
upstream `WinSW-LICENSE.txt` beside `alfc-service.exe`, independently of ALFC's
own `LICENSE`. Preserve the upstream attribution and permission text unchanged.

The manual Linux installation directory is `/opt/alfc`; the command symlink is
`/usr/bin/alfc`. Preflight required release files and init support before changing
files. A foreign command symlink must not be overwritten or removed. Stop an
existing service successfully before overwriting or deleting its files. Preserve
`alfc.config.json` on upgrade and ordinary uninstall; `--purge` deletes it.
Reject a foreign `/usr/bin/alfc` command before uninstalling as well: the service
name is shared with package installations, so preserving that symlink alone does
not establish ownership of the service.
Before mutating an existing service, verify that its declared `ExecStart`
(systemd) or `command` (OpenRC) names the manual installation's executable.
Systemd's read-only `show` properties must also resolve its `FragmentPath` to the
manual unit, or report a genuinely absent unit with `LoadState=not-found`;
refuse vendor/runtime units and failed identity queries. This protects other
installations even when their launcher symlink is missing.
Also verify systemd's effective `ExecStart` is exactly one owned command with its
original arguments; an override can redirect it without changing `FragmentPath`.
Allow harmless generic policy drop-ins rather than rejecting all drop-ins.
Every existing OpenRC runlevel entry must resolve to the owned init script;
accept ordinary absolute and relative links, but reject a foreign target before
stopping or deregistering any service. Include leading-dot runlevel names, which
OpenRC permits for explicit registrations, and deregister every owned runlevel
before deleting the init script.
After a successful stop, a failed systemd disable or OpenRC runlevel
removal must return its failure and retain installation files for retry. Report
that the service was stopped; do not imply it is still running or claim a
successful uninstall. An already absent registration remains safe to remove.
The installer fixes the owned installation directory and optional desktop
resource permissions so a restrictive root umask cannot block unprivileged
Plasma/Omarchy installation. Retain existing configuration bytes and mode.
Preflight expected file/directory types as well as existence. Reject symlinked
installation roots, managed file destinations, and service definitions before
service access: a literal command-link match does not establish ownership of
their targets. Optional desktop directories are owned release resources; retire
their previous installed tree even when the new release omits that integration.
Resolve source and existing installation directories physically, and reject a
release nested anywhere within the installation tree before stopping services;
retiring old resources must never delete the source being installed.

systemd uses `TimeoutStopSec=15s` and journal logging. OpenRC uses
`retry="TERM/15/KILL/5"`, requires local mounts, and orders after module loading;
it does not require external networking. Its background mode currently does not
configure an output log, so use `run.sh` for foreground diagnostics. Unknown init
systems fail before mutation; do not fall back to `killall`.

## Verification

Run `bunx vitest run bootstrap/scripts.test.ts bootstrap/linux-lifecycle.test.ts`
with the repository toolchain.
Linux script tests rebase every privileged filesystem target into a temporary
directory and replace service commands. They verify fresh installation, upgrade,
config preservation, explicit purge, obsolete asset removal, failed stop/restart
reporting, failed deregistration with retry, regular/symlinked foreign-service
refusal, unavailable identity queries, effective command overrides, every OpenRC
runlevel, nested source directories, idempotent removal, and tar layout.
Windows also runs the real batch entrypoints against disposable compiled command
substitutes for administrator detection, SCM queries, and WinSW. These verify
fresh installation, shutdown ordering, dependency preflight, ownership and query
failures, preserved settings, repeated uninstall, and failed-stop/removal aborts
without elevation or host service access. The real Windows PowerShell interpreter
also executes the production identity guard with only its registry boundary
replaced. These checks skip on other platforms. Actual UAC, SCM, and WinSW integration still require
Windows runtime validation. Shell syntax and unit-template verification are useful
additional checks, and must not start host services.
