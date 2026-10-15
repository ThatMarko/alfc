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

Curve drafts survive state updates and reconnects to the same endpoint. **Reload** discards those drafts and clears their unsaved/error feedback. Changing the Server URL loads the new backend's curves, fixed preset, and power limits instead of carrying drafts between machines. A curve ending at `110°C` can still gain points: **Add Point** inserts a valid threshold into an existing gap.

## Panel, tray, and desktop behavior

- The panel shows temperatures, mode/target, and stale or offline status. Vertical panels use a compact layout; **Show icon instead of text** selects icon mode.
- The system tray uses an icon and status badge. The full controls open in a popup.
- The desktop representation shows the full controls directly and supports Plasma's configurable background.
- The tooltip shows connection and telemetry status. Sensor failures, native-service restart guidance, and failed actions remain visible even when another feature still sends telemetry.
- Left-click or keyboard activation opens the popup. Middle-click switches automatic/fixed mode when fan control is available and no mode change is pending. The context menu also offers mode switching, reconnect, web interface, and widget configuration actions.

Telemetry becomes stale after ten seconds without a valid update. If no telemetry arrives within ten seconds of the first validated state with fan control available on a connection, the widget shows **Telemetry unavailable**, keeps readings blank, and offers **Reconnect**. Further state snapshots and pongs do not extend that deadline; valid telemetry clears the warning. When fan control is explicitly unavailable, the backend stops monitoring and no missing-telemetry warning is shown. Cached readings and sensor-failure flags remain visible as last-known information rather than live telemetry. Reconnecting or fan control becoming available again starts a new deadline. A sensor-failure packet contains last-known temperatures, which are not presented as current sensor readings. `restartRequired` displays persistent guidance to restart ALFC while unaffected capabilities remain usable. **Reconnect Backend** only reconnects the widget; it does not restart the service or restore a failed native channel.

Each mutation carries a unique `requestId`. Replies without that ID cannot complete a pending operation. The widget permits at most sixty-four outstanding requests, matching the backend command queue's bound; further commands fail locally until a request completes. Disconnects cancel pending UI operations; requests time out after thirty seconds. A timeout does not prove the backend rejected a change, so the widget does not automatically resend hardware commands. Later state broadcasts still update the displayed configuration. Text pings run every twenty-five seconds, and a missing pong eventually forces a reconnect with retry delays capped at thirty seconds.

## Installation and removal

Install [the runtime dependencies](DEPENDENCIES.md) and start ALFC separately. From the repository root, run the widget installer **as your desktop user**:

```bash
./plasmoid/install.sh
```

The installer resolves `package/` relative to its own location, so it also works when invoked by absolute path from another directory. It uses `kpackagetool6` to install or upgrade `org.kde.alfc`. It does not install the backend, load kernel modules, or modify system services.

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

An absent package is reported without an error. An actual removal failure returns a nonzero status and is not reported as a successful uninstall. System-wide packages installed by a distribution should be managed through its package manager. Removing the widget does not stop ALFC.

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
python3 plasmoid/run_qml_tests.py
```

The runner defaults to the offscreen Qt platform and software scene graph. It exercises a real local Qt WebSocket server, reconnect/backoff behavior, ID correlation, uncorrelated replies, bounded pending requests, timeouts, malformed/incompatible snapshots, the missing-initial-telemetry deadline and fan-availability transitions, capabilities, and Qt URL semantics. When Plasma components are available, it also loads the actual fan editor, checks curve drafts and limits, verifies narrow layouts, and compares canvas images after edits. Editor cases explicitly skip when the Plasma module is absent. Other component-loading failures remain test failures. Qt `6.8.2` with Plasma `6.3.5` passed all 67 cases; Qt `6.12.0` passed 59 cases with eight editor skips.

The main `bun run test` suite executes the shipped QML protocol guards against the same cases as the shared TypeScript guards. Linux CI also runs the Qt-only checks against PySide6 `6.8.2.1` and `6.12.0`; its Ubuntu image does not supply Plasma 6, so editor cases skip there. CI retains Qt stdout/stderr and emits a bounded failure annotation without suppressing the failing exit status.

Tests and their Python runner sit beside this document, outside the installable `package/`. Python, PySide6, QtTest, Node.js, and Bun are not widget runtime dependencies. Full panel/tray/desktop behavior, global shortcut integration, and physical fan hardware still require a real Plasma/hardware smoke test; headless component tests do not establish those results.

Plasma's standard activation shortcut opens the widget. Configure it through Plasma's shortcut settings. The applet does not install a global fan-mode shortcut or capture the bare `Fn` key; firmware-generated key combinations depend on the laptop and desktop mappings.

## Source map and API references

`package/metadata.json` declares the plugin identity and Plasma requirement. `contents/config/` defines the KConfig settings. Under `contents/ui/`, `BackendConnection.qml` owns the socket and pending requests; `Protocol.js` mirrors `common/protocol.ts`; `WidgetUrls.js` handles Qt URL behavior; `WidgetSettings.qml` adapts Plasma settings. `main.qml`, `CompactRepresentation.qml`, and `FullRepresentation.qml` own presentation; `FanTableEditor.qml` owns curve drafts and its Canvas. The remaining QML files are shared layout, heading, and feedback components.

API grounding: Qt [WebSocket](https://doc.qt.io/qt-6/qml-qtwebsockets-websocket.html), [Canvas](https://doc.qt.io/qt-6/qml-qtquick-canvas.html), [DoubleValidator](https://doc.qt.io/qt-6/qml-qtquick-doublevalidator.html), and [layouts](https://doc.qt.io/qt-6/qtquicklayouts-overview.html). Qt's [URL source](https://github.com/qt/qtdeclarative/blob/6.8/src/qml/jsruntime/qv4urlobject.cpp) explains the absent-fragment and decoded-path behavior covered by the URL tests. Plasma registers its applet types in [AppletQuickItem](https://github.com/KDE/libplasma/blob/Plasma/6.3/src/plasmaquick/appletquickitem.cpp) and its action type in [CoreBindingsPlugin](https://github.com/KDE/libplasma/blob/Plasma/6.3/src/declarativeimports/core/corebindingsplugin.cpp).
