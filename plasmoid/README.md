# ALFC Plasmoid

KDE Plasma 6 widget for Aorus Laptop Fan Control.

Works in **panel**, **system tray**, and **desktop widget** modes with context-aware UI.

## Features

- **System tray**: Icon-only compact view with a live status badge and popup controls.
- **Panel**: Responsive compact view showing CPU/GPU temps, mode, and stale/offline state at a glance.
- **Desktop widget**: Full view rendered directly on the desktop with configurable background.
- **Tooltip**: Connection summary with live or stale telemetry details.
- **Middle-click**: Quickly toggle between auto and fixed fan mode directly from the panel or system tray icon.
- **Right-click menu**: Quick actions — switch between auto/fixed fan mode, reconnect the backend, open the web UI, or configure the widget.
- **Full popup**: Complete fan control — mode toggle, fixed speed slider, fan curve editor, GPU boost, CPU tuning (PL1/PL2).
- **Backend parity**: Backend snapshots remain authoritative; unavailable controls are disabled. Fixed presets can be saved in auto mode. Curves support fractional temperatures and percentages, and the graph displays the backend's actual temperature thresholds.
- **Live data**: WebSocket connection with keepalive ping/pong and automatic reconnection.
- **Request feedback**: Each change has a unique request ID. Connection loss and a 30-second timeout release pending controls without resending hardware commands automatically.
- **Accessibility**: Keyboard activation in compact mode and explicit screen reader labels for the popup controls.

## Installation

```bash
./install.sh
```

Or manually:

```bash
kpackagetool6 --type Plasma/Applet --install package
```

After installing:

- **Panel**: Right-click panel → Add Widgets → search "Aorus"
- **System tray**: Right-click system tray → Configure System Tray → Entries → set "Aorus Laptop Fan Control" to "Shown"
- **Desktop**: Right-click desktop → Add Widgets → search "Aorus"

### Upgrade

```bash
./install.sh
```

The script detects an existing install and upgrades automatically.

### Uninstall

```bash
./uninstall.sh
```

## Configuration

Right-click the widget → Configure → General:

- **Server URL**: WebSocket endpoint (default: `ws://localhost:5522/ws`; must start with `ws://` or `wss://` and end with `/ws`).
- **Web interface URL**: Optional `http://` or `https://` override. When left blank, it is derived automatically from the Server URL and displayed under **Resolved web interface**.
- **Warning temperature (°C)**: Threshold for critical warning colors/status (default: `90°C`, range `50–110°C`, step `5°C`; warm status begins `10°C` below the threshold).
- **Panel display**: Choose icon-only compact mode instead of the text layout.

## Structure

```
package/
├── metadata.json                    # Plugin metadata, system tray registration
├── contents/
│   ├── config/
│   │   ├── config.qml               # Config dialog structure
│   │   └── main.xml                  # KConfigXT schema
│   └── ui/
│       ├── main.qml                  # Entry point: context detection, status, tooltip, context menu
│       ├── CompactRepresentation.qml # Icon (tray) or text label (panel)
│       ├── FullRepresentation.qml    # Complete fan control popup/desktop view
│       ├── BackendConnection.qml     # WebSocket client with keepalive and reconnection
│       ├── FanTableEditor.qml        # CPU/GPU fan curve editor with validation
│       ├── ConfigGeneral.qml         # Widget configuration page
│       ├── InlineStatusMessage.qml   # Shared inline status feedback
│       ├── MetricTile.qml            # Overview stat card
│       ├── SectionCard.qml           # Full-view section wrapper
│       ├── WidgetSettings.qml        # Declarative settings adapter for Plasmoid.configuration
│       ├── WidgetUrls.js             # Qt URL validation and IPv6-safe web UI derivation
│       ├── Protocol.js               # Runtime guards matching common/protocol.ts
│       └── WidgetHeading.qml         # Popup/desktop heading with actions
```

## Development

View in a standalone window:

```bash
plasmoidviewer -a package
```

Or:

```bash
plasmawindowed org.kde.alfc
```

### Dependencies

See [DEPENDENCIES.md](DEPENDENCIES.md) for required packages by distribution.

### Runtime tests

From the repository root, with the development-only `PySide6` Python package installed:

```bash
python3 plasmoid/run_qml_tests.py
```

The runner uses the offscreen Qt platform by default. It tests a real local Qt WebSocket server, reconnects, request correlation, timeouts, malformed messages, legacy protocol fields, and Qt URL parsing. With the Plasma 6 QML components installed, it also renders the fan editor and compares canvas images after successive edits. Those editor cases report skipped when Plasma components are unavailable.

When using pip's bundled Qt, set `QML_IMPORT_PATH` to your distribution's matching Qt 6 module directory to include KDE modules (for example, `/usr/lib/x86_64-linux-gnu/qt6/qml` on Debian). The Linux CI job runs the connection, protocol, and URL tests with PySide6; it skips the four editor cases because its Ubuntu image does not provide Plasma 6.

Fixtures live beside the runner, outside the installable `package/`, so QtTest and Python are not widget runtime dependencies. The main `bun run test` suite also executes the shipped QML protocol guards against the same cases as the TypeScript guards. Complete panel, tray, and desktop integration still requires `plasmoidviewer` or a Plasma desktop session; standalone Qt tests do not verify shell layout, global shortcuts, or physical fan hardware.

The implementation follows Qt's [WebSocket lifecycle](https://doc.qt.io/qt-6/qml-qtwebsockets-websocket.html), [Canvas painting](https://doc.qt.io/qt-6/qml-qtquick-canvas.html), and [DoubleValidator](https://doc.qt.io/qt-6/qml-qtquick-doublevalidator.html) APIs. Qt's [URL implementation](https://github.com/qt/qtdeclarative/blob/6.8/src/qml/jsruntime/qv4urlobject.cpp) differs from browser URLs for absent fragments and IPv6 host formatting; the runtime URL cases cover both behaviors.

### Keyboard Shortcuts

The `Fn` key is firmware-level and cannot be captured by KDE. To set up a custom fan shortcut, use System Settings → Shortcuts → Custom Shortcuts with a command targeting `ws://localhost:5522/ws`.

The widget gets one global activation shortcut via Plasma (configurable in System Settings → Shortcuts → search "Aorus").
