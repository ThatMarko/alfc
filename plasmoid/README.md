# ALFC Plasma 6 widget

The `org.kde.alfc` applet is a native QML client for the ALFC backend. It provides panel, system-tray, and desktop representations. It installs separately from the fan-control service and requires a running backend with **protocol 1.1 or a newer major-1 minor version**. Protocol 1.0 backends are rejected because they cannot reliably echo request IDs.

The widget supports the same primary controls as the web interface. Raw WMI/ACPI diagnostics and update notifications remain in the web interface; the widget opens that interface from its heading and context menu.

## Controls and backend state

| Control            | Accepted values                                                                                                               | Availability                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Auto/fixed mode    | Automatic curves or the stored fixed preset                                                                                   | Disabled when the backend reports fan control unavailable.                               |
| Fixed preset       | Whole percentages from `0` to `100`                                                                                           | Can be saved while automatic mode is active; saving a preset does not enable fixed mode. |
| CPU/GPU fan curves | Nonempty tables; strictly increasing temperatures from `0` to `110°C`; speeds from `0` to `100%`; fractional values supported | Both tables are validated and saved together.                                            |
| CPU power limits   | Whole `PL1` and `PL2` values from `0` to `200 W`                                                                              | Shown only when `isCpuTuningAvailable` is `true`.                                        |
| GPU boost          | Enabled or disabled                                                                                                           | Shown only when `isGpuBoostAvailable` is `true`.                                         |

The backend's state broadcasts determine active configuration, including changes made by another client. A missing optional fan-availability flag retains the legacy permissive behavior; an explicit `false` disables fan commands. CPU tuning and GPU boost require explicit availability. The service performs the final validation and hardware calls.

Fan output comes from telemetry, not from the stored preset. `0%` is a valid reported output; `null` is unconfirmed output. Automatic-mode percentages in the compact view are targets. The fan graph displays temperature thresholds rather than linear interpolation: the first point applies below its temperature, and each subsequent point changes the target at its temperature. Both fans use the higher CPU/GPU target, with the backend's ramping rules determining the applied output.

Curve drafts survive state updates and reconnects to the same endpoint. Fixed-percentage and power-limit drafts survive updates to unrelated fields; an authoritative change to the same field resynchronizes that field, including while it has keyboard focus. **Reload** discards those drafts and clears their unsaved/error feedback. Changing the Server URL loads the new backend's curves, fixed preset, and power limits instead of carrying drafts between machines. A curve ending at `110°C` can still gain points: **Add Point** inserts a valid threshold into an existing gap.

## Panel, tray, and desktop behavior

- The panel shows temperatures, mode/target, and stale or offline status. Vertical panels use a compact layout; **Show icon instead of text** selects icon mode.
- The system tray uses an icon and status badge. The full controls open in a popup.
- The desktop representation shows the full controls directly and supports Plasma's configurable background.
- The tooltip shows connection and telemetry status. Sensor failures, native-service restart guidance, and failed actions remain visible even when another feature still sends telemetry.
- Left-click or keyboard activation opens the popup. Middle-click switches automatic/fixed mode when fan control is available and no mode change is pending. The context menu also offers mode switching, reconnect, web interface, and widget configuration actions.

Telemetry becomes stale after ten seconds without a valid update. If no telemetry arrives within ten seconds of the first validated state with fan control available on a connection, the widget shows **Telemetry unavailable**, keeps readings blank, and offers **Reconnect**. Further state snapshots and pongs do not extend that deadline; valid telemetry clears the warning. When fan control is explicitly unavailable, the backend stops monitoring and no missing-telemetry warning is shown. Cached readings and sensor-failure flags remain visible as last-known information rather than live telemetry. Reconnecting or fan control becoming available again starts a new deadline. A sensor-failure packet contains last-known temperatures, which are not presented as current sensor readings. Its tooltip reports the last acknowledged paired fan command, or unconfirmed output; a mode-settings broadcast alone does not establish a newly applied command or physical fan rotation. `restartRequired` displays persistent guidance to restart ALFC while unaffected capabilities remain usable. **Reconnect Backend** only reconnects the widget; it does not restart the service or restore a failed native channel.

Each mutation carries a unique `requestId`. Replies without that ID cannot complete a pending operation. The widget permits at most sixty-four outstanding requests, matching the backend command queue's bound; further commands fail locally until a request completes. Disconnects cancel pending UI operations; requests time out after thirty seconds. A timeout does not prove the backend rejected a change, so the widget does not automatically resend hardware commands. Later state broadcasts still update the displayed configuration. Text pings run every twenty-five seconds, and a missing pong eventually forces a reconnect with retry delays capped at thirty seconds.

The connection handshake and the subsequent wait for a validated settings snapshot each have a ten-second deadline. Invalid snapshots and heartbeat traffic do not extend the settings deadline; losing readiness after an invalid update starts a new deadline. A timeout reconnects without replaying commands. Malformed success/error envelopes cannot confirm pending operations; optional method metadata must be strings when supplied, and errors must contain a string diagnostic.

A backward system-clock correction invalidates cached telemetry and reconnects the widget so request and heartbeat deadlines cannot remain postponed until the old time catches up. Pending actions fail without replay. Backend diagnostics are rendered as literal text, preserving path-like angle brackets, ampersands, line breaks, and repeated spaces.

## Installation and removal

Install [the runtime dependencies](DEPENDENCIES.md) and start ALFC separately. The installer/remover also uses Python 3's standard library to verify package metadata before allowing KPackage to change an existing installation. From the repository root, run the widget installer **as your desktop user**:

```bash
./plasmoid/install.sh
```

The installer resolves `package/` relative to its own location, so it also works when invoked by absolute path from another directory. It uses `kpackagetool6` to install or upgrade `org.kde.alfc` under `${XDG_DATA_HOME:-$HOME/.local/share}/plasma/plasmoids/`. `XDG_DATA_HOME`, when set, must be absolute. A system-wide package alone does not select a user upgrade; the installer creates a user package that takes precedence for that user. Symlink and non-directory user-package destinations are rejected. Source and existing user metadata must declare `KPlugin.Id` as `org.kde.alfc`; missing, malformed, symlinked, or foreign metadata causes a failure before package changes, preserving neighboring applets. It does not install the backend, load kernel modules, or modify system services.

Before upgrading an existing user package, the installer validates the candidate through KPackage in a private temporary package root. A failed validation returns its error and preserves the working user copy; the temporary package is cleaned up. Resolved source and installation directories must not overlap, including through symlinks: an upgrade could otherwise remove its own source, or an installation could copy recursively into itself. The subsequent real upgrade remains a KPackage operation: an interruption or filesystem failure after that operation begins can require rerunning the installer.

Manual installation and upgrade from the repository root:

```bash
kpackagetool6 --type Plasma/Applet --install plasmoid/package
kpackagetool6 --type Plasma/Applet --upgrade plasmoid/package
```

Add **Aorus Laptop Fan Control** through Plasma's **Add Widgets** dialog. For the tray, enable its entry in **Configure System Tray → Entries**. After an upgrade, an existing applet may need to be removed and re-added, or the Plasma session restarted, to reload its QML.

Remove widget instances and uninstall the user package:

```bash
./plasmoid/uninstall.sh
```

An absent user package is reported without an error, including when a system-wide copy exists. An existing package that cannot be removed or has invalid metadata returns a nonzero status and is not reported as an absent or successful uninstall. Both scripts explicitly target the user's package directory. System-wide packages installed by a distribution should be managed through its package manager; removing a user copy can expose an existing system copy again. Plasma's applet configuration and other desktop settings are preserved by the scripts. Removing the widget does not stop ALFC.

## Configuration

Open **Configure Widget → General**:

| Setting             | Behavior                                                                                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server URL          | Blank uses `ws://localhost:5522/ws`. Custom `ws://` or `wss://` URLs must resolve to a path ending in `/ws` or `/ws/`, with no query or fragment. IPv6 is supported.                    |
| Web interface URL   | Optional `http://` or `https://` override. Otherwise the widget changes the WebSocket scheme and removes the final `/ws`, preserving the port, IPv6 brackets, and encoded proxy prefix. |
| Warning temperature | Default `90°C`; configurable from `50` to `110°C` in steps of `5°C`. Warm coloring begins ten degrees below it. This changes display warnings, not fan-control policy.                  |
| Panel display       | Select icon mode instead of the panel's temperature text.                                                                                                                               |

In production, the supported local web address uses plain HTTP on port `5522`. Both `/ws` and `/ws/` reach the same backend WebSocket handler. During `bun run start`, set the web-interface override to `http://localhost:3000` for Vite.

The URL parser accepts TLS schemes, other ports, and encoded prefixes for custom native-client endpoints. URL derivation only formats a link: the shipped web UI always connects to `ws://<page hostname>:5522/ws`, and its built assets use root paths. HTTPS and proxy-prefix web deployments are unsupported. The backend listens on loopback, and remote exposure remains unsupported; a widget setting does not change that binding or provide authentication. The settings page displays URL validation errors; fix them before saving.

## Development and validation

From the repository root, preview the full applet in a Plasma 6 environment:

```bash
plasmoidviewer -a plasmoid/package
# Or preview an installed package:
plasmawindowed org.kde.alfc
```

The development-only Qt test runner uses PySide6. Installation, matching KDE import paths, and required native libraries are described in [DEPENDENCIES.md](DEPENDENCIES.md#development-checks).

```bash
python3 plasmoid/run_qml_tests.py --tier qt-only
# Disposable package-command fixtures; no Plasma session is touched:
python3 plasmoid/test_install.py
# Native Debian 13 Qt + Plasma/Kirigami component tier:
bash plasmoid/run_component_tests.sh
```

Both runners default to the offscreen Qt platform and software scene graph. Qt-only tests exercise a real local Qt WebSocket server, reconnect/backoff behavior, request correlation and limits, timeouts, malformed/incompatible snapshots, initial-telemetry deadlines, capabilities, and Qt URL semantics. Only that tier may skip missing optional Plasma components; an installed but broken plugin fails.

The required CI **Plasma components (Debian 13)** tier compiles a native Qt Quick Test runner against the same distribution's Qt `6.8.2`, Plasma `6.3.5`, and Kirigami `6.13`. Its dependencies are tracked in [the package manifest](https://github.com/ThatMarko/alfc/blob/master/plasmoid/tests/debian-component-packages.txt); [the setup instructions](DEPENDENCIES.md#required-matching-component-tier) describe the reproducible disposable environment. It must execute every editor and component case without optional-module skips. Tests cover independent pending mode/percentage/curve/boost/tuning operations, draft synchronization, endpoint changes, disconnect recovery without replay, capability loss, missing/stale/failed telemetry and unconfirmed output, keyboard input, narrow/desktop/compact layouts, configuration validation and aliases, and settings persistence in a private temporary file.

Full, compact, and settings tests use the actual production QML with real Plasma/Kirigami controls. The tracked test setup substitutes the shell-owned heading, applet singleton and `PlasmoidItem` boundary. These are explicitly **standalone component tests with a shell boundary fixture**. They do not establish full Plasma-shell, global-shortcut, KConfig-dialog or physical hardware results.

The main `bun run test` suite executes the shipped QML protocol guards against the same cases as the shared TypeScript guards. CI retains Qt diagnostics and the component job's resolved distribution package versions. The disposable installer fixtures cover user/system package separation, upgrades/removal, preserved desktop configuration, invalid/foreign metadata, incomplete upgrade candidates, package-command failures, overlapping source/destination trees, symlinks, and escaped paths using a controlled package adapter. Python is also used by the install/remove scripts; PySide6, C++, CMake, Ninja and QtTest are development dependencies, outside the installable `package/`.

For the full-session tier, record Plasma/Qt versions and perform this manual checklist on an actual Plasma 6 desktop:

- Install, upgrade, reload and remove the user applet; reopen configuration and verify all four values persist after logout/login.
- Check horizontal and vertical panels, tray expansion, desktop controls, keyboard activation/focus, 200% scale, translated/long text, tooltips, and configuration actions.
- Start with the backend absent, then start/restart it; change endpoints during pending work and verify drafts and interrupted-request guidance. Destroy/recreate applets and reload the bar without leaked sockets or duplicate subscriptions.
- Connect the web UI simultaneously, update each configuration field, and verify unrelated drafts survive while changed authoritative values resynchronize.
- Record physical fan output, power behavior, restart-required recovery, and BIOS handoff separately on supported hardware. Automated component/protocol tests do not establish those observations.

Plasma's standard activation shortcut opens the widget. Configure it through Plasma's shortcut settings. The applet does not install a global fan-mode shortcut or capture the bare `Fn` key; firmware-generated key combinations depend on the laptop and desktop mappings.

## Source map and API references

`package/metadata.json` declares the plugin identity and Plasma requirement. `contents/config/` defines the KConfig settings. Under `contents/ui/`, `BackendConnection.qml` owns the socket and pending requests; `Protocol.js` mirrors `common/protocol.ts`; `WidgetUrls.js` handles Qt URL behavior; `TextFormatting.js` escapes literal diagnostics for Kirigami labels; `WidgetSettings.qml` adapts Plasma settings. `main.qml`, `CompactRepresentation.qml`, and `FullRepresentation.qml` own presentation; `FanTableEditor.qml` owns curve drafts and its Canvas. The remaining QML files are shared layout, heading, and feedback components.

API grounding: Qt [WebSocket](https://doc.qt.io/qt-6/qml-qtwebsockets-websocket.html), [Canvas](https://doc.qt.io/qt-6/qml-qtquick-canvas.html), [DoubleValidator](https://doc.qt.io/qt-6/qml-qtquick-doublevalidator.html), [layouts](https://doc.qt.io/qt-6/qtquicklayouts-overview.html), [Settings](https://doc.qt.io/qt-6/qml-qtcore-settings.html), and [callLater](https://doc.qt.io/qt-6/qml-qtqml-qt.html#callLater-method). Qt's [URL source](https://github.com/qt/qtdeclarative/blob/6.8/src/qml/jsruntime/qv4urlobject.cpp) explains the absent-fragment and decoded-path behavior covered by the URL tests. Plasma registers its applet types in [AppletQuickItem](https://github.com/KDE/libplasma/blob/Plasma/6.3/src/plasmaquick/appletquickitem.cpp) and its action type in [CoreBindingsPlugin](https://github.com/KDE/libplasma/blob/Plasma/6.3/src/declarativeimports/core/corebindingsplugin.cpp).
