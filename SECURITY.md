# Security Policy

## Reporting a vulnerability

Please do **not** open a public issue for security problems.

Report them privately:

- **Preferred:** GitHub private vulnerability reporting — the repository's
  Security tab → "Report a vulnerability" (only the maintainer can see it).
- **Fallback:** email the maintainer directly (see the author fields in
  `package.json` / `plasmoid/package/metadata.json`).

Include, if possible:

- ALFC version (release tag or commit) and how it was installed
- OS/distro and laptop model
- Steps to reproduce, and any relevant logs
- Whether the issue requires local or remote access

We will acknowledge reports as soon as possible, keep you informed of progress,
and credit you when a fix is released (unless you prefer not to be named).
Please give us a reasonable window to fix the issue before public disclosure.

## Supported versions

ALFC is a hardware control daemon that runs with elevated privileges; the
supported surface is:

- The latest stable release (none published yet while ALFC is pre-1.0 — treat
  `master` as the supported surface until then)
- `master` on a best-effort basis

Older alpha tags (`v2.0.0-alpha.*`) are pre-release builds and are not
supported.

## Threat model and scope

- The server binds to `localhost:5522`. The WebSocket origin check only guards
  against browser-based cross-site requests; it is **not** authentication — any
  local process (or local malicious website, via WebSocket or HTTP probing) can
  reach the endpoint. See `common/PROTOCOL.md` ("Security").
- The server runs as root/admin and writes to platform ACPI/WMI interfaces.
  Vulnerabilities in message parsing, config loading, or the WMI helper
  subprocess are in scope; so is anything that could allow a non-privileged
  local process to influence hardware state it should not control.

Out of scope: hardware-side issues (EC firmware, BIOS behavior), and issues in
upstream projects (Bun, WinSW, acpi_call, KDE Plasma) unless exposed through
this codebase.
