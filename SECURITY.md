# Security Policy

## Reporting a vulnerability

Please avoid public issues for security reports. Use GitHub's Security tab →
"Report a vulnerability" if private reporting is enabled, or email the
maintainer at <markox123@icloud.com> (also recorded in `package.json`). Private
GitHub reports are visible to maintainers and any collaborators they authorize;
they are not limited to one person.

Include the ALFC revision or release, installation method, OS, laptop model,
reproduction steps, relevant redacted logs, and whether exploitation requires
local access. Coordinate disclosure with the maintainer. Do not send device
credentials or unrelated personal information. Community-conduct reports use
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Version status

`feat/wmi-ffi` is under review in PR #1. Package metadata says `2.0.0`, but the
published tags inspected during this audit were alpha tags; this document does
not promise a stable release or a support SLA. Report current-branch issues
with a commit hash and released issues with their exact tag. Older alpha
artifacts may use different native helpers and do not establish current behavior.

## Trust boundaries

- The elevated backend binds explicitly to `127.0.0.1:5522` and, when available,
  `[::1]:5522`. It does not bind wildcard or LAN addresses. An occupied IPv6
  port fails startup instead of silently leaving clients on different services.
- WebSocket upgrades validate browser origins against loopback HTTP(S) hosts.
  Requests without Origin remain allowed for native clients. This check is not
  authentication: other local processes and local users can send commands.
  Other services hosted on allowed loopback origins are inside that trust boundary.
- HTTP serves local static frontend files and validates paths and methods.
  Hardware changes use WebSocket commands, with bounded message size, queue,
  and backpressure. Raw diagnostics are powerful despite signature validation;
  managed fan setters are blocked to preserve controller ownership.
- Production configuration resides beside the executable. Protect its directory
  and binaries against unprivileged modification. Invalid configurations fall
  back to defaults; validation bounds are not proof that those settings are
  appropriate for a particular laptop.
- Windows WMI executes native COM/FFI in a dedicated worker. Optional CPU tuning
  uses a separate worker. Workers isolate blocking calls and watchdog state;
  they are not privilege or memory-security sandboxes. NativeAOT libraries
  cannot safely be unloaded, and a timeout cannot cancel a hung driver call.
- Linux hardware access writes to `/proc/acpi/call` and Intel RAPL sysfs files.
  A hung firmware operation can outlive the JavaScript timeout. Shutdown makes
  a bounded best-effort attempt to restore BIOS control.

Remote exposure is unsupported. A proxy does not add protocol authentication;
any future remote-control feature needs an explicit authorization design.
See [the protocol security section](common/PROTOCOL.md#security-boundary) for wire-level
constraints and [PORTING_REVIEW.md](PORTING_REVIEW.md) for native limitations.

Message parsing, native memory/ABI handling, path traversal, unsafe loading or
persistence, and service installation permissions are in scope. Report upstream
Bun, WinSW, Qt, or driver issues here when ALFC exposes them; otherwise report
them upstream. Hardware/BIOS defects without an ALFC vulnerability need platform
vendor support. Development dependencies are audited with `bun audit`; build
and test tooling must not be exposed as a public service.
