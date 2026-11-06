# Omarchy integration

ALFC runs its existing Linux backend and web dashboard on Omarchy. The optional
bar module in [omarchy/](https://github.com/ThatMarko/alfc/tree/master/omarchy) adds a read-only status and a browser launcher
for Omarchy's Quickshell bar. It is a distinct integration from the Plasma applet;
it does not install Plasma, access ACPI/RAPL, or control hardware itself.

## Supported desktop and prerequisites

The module was written against **Omarchy v4.0.4** (tag commit
`c668141e9c42b13c80c9ca4ea108e11708c5e8a5`). On **2026-11-06** the official
latest-release redirect resolved to **Omarchy v4.5.0** (tag commit
`ac2690cd7be4f47e4a255f5e2e78d904d436b068`, released 2026-11-05). A
documentation review of v4.5.0 found the custom QML module contract this module
uses unchanged: a `"type": "qml"` layout entry with `source` and inline settings,
and the injected `bar.foreground`, `fontFamily`, `vertical`, `barSize`,
`showTooltip`, and `hideTooltip` members. The module does not import the
`qs.Commons` palette, so v4.5.0's Qt 6.12 `Commons.Color` qualification does not
apply. No full v4.5.0 session result is recorded yet; see
[Release validation](#release-validation). Rolling Arch package versions remain
those of the user's installed system; an Omarchy tag does not pin every Qt or
Hyprland binary.

Check the installed desktop before choosing this integration:

```bash
omarchy-version
pacman -Q quickshell qt6-declarative qt6-websockets python
quickshell --version
hyprctl version
```

`omarchy-version` is the upstream version command (unchanged between v4.0.4 and
v4.5.0): it reads the installed `omarchy`/`omarchy-dev` package version for
`/usr/share/omarchy`, and reports `dev` with a Git hash for a source checkout
selected by `OMARCHY_PATH`. A `dev` result or a stable release other than v4.0.4
or v4.5.0 requires checking its shell API before assuming this support scope
applies; the repository's `version` file alone is not an installed-release check.

The module needs Quickshell with matching system **Qt 6 QtQuick and QtWebSockets**
QML modules. Arch supplies QtWebSockets in `qt6-websockets`; install that package
if it is absent. Python 3 is used by the installer/remover only. A packaged ALFC
backend embeds Bun; neither the bar module nor packaged backend needs a separate
Node or Bun runtime. Development still uses the toolchain in
[CONTRIBUTING.md](CONTRIBUTING.md). Do not mix PySide wheel plugins with the
desktop's system Qt plugins.

Install and configure the backend following [LINUX.md](LINUX.md), including the
kernel-specific `acpi_call` prerequisites and firmware limitations. Open
<http://127.0.0.1:5522/> in an ordinary user browser and confirm its capability and
connection state. Hardware support is the Linux support boundary in
[common/COMPATIBILITY.md](common/COMPATIBILITY.md); desktop integration does not
establish compatibility with a laptop model or BIOS. Do not run another fan
controller alongside ALFC without reviewing its actual hardware ownership.

The launcher opens the bundled production dashboard on port 5522. For source
development, start the web development server separately and use its port 3000
URL; the bar launcher intentionally retains the production URL.

## Install and configure the optional bar module

Run the following as your desktop user, from the extracted Linux release root or
the source checkout. For an AUR/manual package that includes the optional sources,
use its installed documentation/module directory as described in
[LINUX.md](LINUX.md). The installer needs its adjacent
`plasmoid/package/contents/ui/Protocol.js` resource as well as `omarchy/`.

```bash
bash omarchy/install.sh
```

The installer copies three files into
`${XDG_CONFIG_HOME:-$HOME/.config}/omarchy/bar/modules/alfc/` and prints **one JSON
entry** with the correctly escaped absolute `source` path. Add that entry to one
existing `bar.layout` section array in your user-owned
`~/.config/omarchy/shell.json`: `left`, `center`, or `right` on v4.0.4; on
v4.5.0 also `centerBegin`, `centerEnd`, or `tray` (v4.5.0 removed
`centerAnchor`). For example:

```json
{
  "id": "alfc",
  "type": "qml",
  "source": "/home/your-user/.config/omarchy/bar/modules/alfc/Widget.qml",
  "serverUrl": "ws://127.0.0.1:5522/ws"
}
```

Use the actual installer output for `source`. Preserve the other entries and
top-level settings. If `shell.json` does not exist, first create your user bar
configuration through Omarchy's bar settings; do not replace the existing or
default layout with this example. Settings are inline on the entry, without a
`config` sub-object. The installer never edits layouts, themes, bindings,
autostart files, or distribution files under `/usr/share/omarchy`.

After saving, ask the existing shell to reread its configuration:

```bash
omarchy-shell shell reloadConfig
```

No automatic desktop restart is performed. Left-click the module, activate it
with Return/Space when focused, or use its accessibility press action to open
ALFC in the current user session. Vertical bars show `A`; the tooltip and
accessible name retain the full status. The module uses the bar's foreground,
font, orientation, and size.

The optional `serverUrl` accepts only `ws://127.0.0.1:5522/ws`,
`ws://localhost:5522/ws`, or `ws://[::1]:5522/ws`, with an optional trailing slash.
IPv6 requires the backend's IPv6 listener. Invalid/remote endpoints show
**Check settings** and never connect. The launcher derives a local HTTP URL from
the validated endpoint and uses Qt's desktop URL opener without shell
interpolation. An invalid setting falls back to the fixed local dashboard URL.

## Status, recovery, and resource ownership

| Display          | Meaning                                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| Offline          | The connection is closed or the backend has not started.                                                             |
| Waiting          | Waiting for a validated initial snapshot or the first telemetry packet.                                              |
| Protocol error   | A state snapshot failed the existing protocol 1.1/1.x guards.                                                        |
| Stale            | No valid telemetry for at least ten seconds while monitoring is expected, including a missing first packet.          |
| Sensor failure   | The backend explicitly reports failed sensors; cached temperatures are not presented as current.                     |
| Unconfirmed      | A paired fan write has no confirmed percentage (`appliedSpeed: null`).                                               |
| Unavailable      | The backend reports fan monitoring unavailable. Other dashboard features may still work.                             |
| Restart required | A native channel permanently failed; restart the ALFC service to retry it.                                           |
| ALFC 35%         | The last acknowledged paired fan command, with current telemetry. This is not RPM or proof of physical fan rotation. |

Restart guidance takes priority over the other connected states. State pushes
and pongs never refresh telemetry. Capability restoration starts a new telemetry
grace period and requires a new activity packet. Reconnects discard the old
session's snapshot and readings. Sleep/resume or a backward clock adjustment
retires the connection when detected by the next timer tick.

Each loaded instance owns one persistent WebSocket, one one-second connection/
freshness timer while connecting or connected, and one single-shot reconnect timer. Reconnect
delay grows from one to thirty seconds; heartbeats occur every twenty-five
seconds, with a sixty-second response watchdog. A connection without a valid
initial snapshot is retried after ten seconds; a peer that never completes its
WebSocket handshake also has a ten-second deadline. Telemetry uses the existing
subscription, without periodic subprocesses or independent hardware polling.
Multiple monitors/modules or other clients each have their own bounded
connection. Destruction closes the socket, cancels reconnects, and hides its
tooltip. No hardware commands are sent or replayed.

The module validates snapshots and activity with the exact existing
[QML protocol guards](https://github.com/ThatMarko/alfc/blob/master/plasmoid/package/contents/ui/Protocol.js), copied at install
time; it imports no Plasma UI modules. It discards messages longer than 1,048,576
UTF-16 code units before JSON parsing. This separate response budget accommodates
state snapshots larger than the server's 64 KiB request limit, including added
settings/capability fields and numeric serialization. Every message within the
server's 1 MiB UTF-8 outbound budget fits this ceiling because UTF-16 code-unit
counts never exceed UTF-8 byte counts. Dynamic labels contain validated numbers, backend error
strings are not inserted into labels/tooltips, and text is displayed as plain
text (including Omarchy v4.0.4's shared tooltip). No JSON HTTP health endpoint or
privileged network exposure is added. See [common/PROTOCOL.md](common/PROTOCOL.md).

## Upgrade and remove

Rerun `bash omarchy/install.sh` from the new extracted release/source to upgrade
the owned module files, then reload the shell configuration. Existing inline
settings and unrelated files are preserved. Back up local edits to the module's
own QML before upgrading; owned code files are replaced. A foreign directory,
ownership marker, or symlink in an owned file causes installation/removal to
fail instead of following it.

Remove the module's single layout entry from `shell.json`, reload configuration,
then run from the same installation source, using the same `XDG_CONFIG_HOME`:

```bash
bash omarchy/uninstall.sh
```

Removal deletes only the three named owned files; unrelated files and all other
configuration remain. The ownership marker is removed with an empty directory,
or retained alongside unrelated files or when the parent prevents directory
removal, so repeated removal and later installation remain safe. The backend's separate service/package removal remains documented in
[LINUX.md](LINUX.md).

Older/customized Waybar setups are outside this Quickshell module's API. The
local dashboard remains usable there. Do not load the Plasma applet or this QML
module as a Waybar command module; no separate Waybar transport is shipped.

## Automated and manual validation

Run the staged module's real Qt WebSocket tests and actual installer fixtures:

```bash
python3 omarchy/run_tests.py --qml-runner /usr/lib/qt6/bin/qmltestrunner
```

This requires a matching system Qt 6 QtQuick/QtTest/QtWebSockets environment. The
explicit Qt-only PySide alternative uses the project's existing test harness:

```bash
python3 omarchy/run_tests.py --qt-python /path/to/qt-test-venv/bin/python
```

Missing required Qt dependencies fail the tests. Fixtures cover absent/late
backend startup, restarts, no replay, concurrent clients, missing/stale/invalid
telemetry, failed/unconfirmed output, capability loss/recovery, restart guidance,
heartbeat loss, repeated stalled WebSocket handshakes, simulated sleep/resume, destruction, keyboard launch, narrow
vertical presentation, unsafe endpoints, JSON/path escaping, idempotent setup,
and foreign ownership/symlink refusal. The harness stages the same three runtime
files as installation. These are Qt-only component/transport checks with a fake
backend, not a full Omarchy shell or physical-device result.

Before declaring full desktop validation on the supported release, record:

1. Real Omarchy package versions (v4.5.0 or the then-current release, plus
   v4.0.4 if still claimed) and successful module load using system Qt.
2. Login without the service, late service startup, sleep/resume, service restart,
   shell configuration reload, and repeated removal/reinstallation.
3. Horizontal/vertical bars, multiple monitors, keyboard focus, font scaling,
   accessibility, tooltip presentation, translated labels, and browser launching.
4. Simultaneous web/module sessions and capability/restart/stale presentations.
5. Separately, physical fan/temperature/power and BIOS shutdown handoff checks on
   each supported laptop/firmware combination.

Full Omarchy-session and physical-device evidence remains a manual release gate.

## Version-matched official sources

- [Omarchy latest release](https://github.com/omacom/omarchy/releases/latest), checked against [v4.0.4](https://github.com/omacom/omarchy/releases/tag/v4.0.4) and [v4.5.0](https://github.com/omacom/omarchy/releases/tag/v4.5.0).
- [v4.5.0 shell API](https://github.com/omacom/omarchy/blob/v4.5.0/docs/omarchy-shell.md), [custom module documentation](https://github.com/omacom/omarchy/blob/v4.5.0/shell/plugins/bar/README.md), and [top-bar manual](https://github.com/omacom/omarchy/blob/v4.5.0/manual/05-the-top-bar.md).
- [v4.0.4 top-bar manual](https://github.com/omacom/omarchy/blob/v4.0.4/manual/05-the-top-bar.md).
- [v4.0.4 shell API](https://github.com/omacom/omarchy/blob/v4.0.4/docs/omarchy-shell.md) and [custom module implementation/documentation](https://github.com/omacom/omarchy/blob/v4.0.4/shell/plugins/bar/README.md).
- [v4.0.4 user-owned dotfiles](https://github.com/omacom/omarchy/blob/v4.0.4/manual/31-dotfiles.md) and [desktop package list](https://github.com/omacom/omarchy/blob/v4.0.4/install/omarchy-base.packages).
- [v4.0.4 installed-version detection](https://github.com/omacom/omarchy/blob/v4.0.4/bin/omarchy-version).
- [Qt WebSocket QML API](https://doc.qt.io/qt-6/qml-qtwebsockets-websocket.html) and [Arch QtWebSockets package](https://archlinux.org/packages/extra/x86_64/qt6-websockets/).
