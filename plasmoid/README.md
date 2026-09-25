# ALFC Plasmoid

KDE Plasma 6 widget for Aorus Laptop Fan Control.

Works in **panel**, **system tray**, and **desktop widget** modes with context-aware UI.

## Features

- **System tray**: Icon-only compact view with a live status badge and popup controls.
- **Panel**: Responsive compact view showing CPU/GPU temps, mode, and stale/offline state at a glance.
- **Desktop widget**: Full view rendered directly on the desktop with configurable background.
- **Tooltip**: Connection summary with live or stale telemetry details.
- **Right-click menu**: Quick actions — switch between auto/fixed fan mode, reconnect the backend, open the web UI, or configure the widget.
- **Full popup**: Complete fan control — mode toggle, fixed speed slider, fan curve editor, GPU boost, CPU tuning (PL1/PL2).
- **Live data**: WebSocket connection with keepalive ping/pong and automatic reconnection.
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

- **Server URL**: WebSocket endpoint (default: `ws://localhost:5522/ws`)
- **Web interface**: Derived from the server URL and shown for reference.
- **Warning temperature**: Threshold for warning colors/status.
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

### Keyboard Shortcuts

The `Fn` key is firmware-level and cannot be captured by KDE. To set up a custom fan shortcut, use System Settings → Shortcuts → Custom Shortcuts with a command targeting `ws://localhost:5522/ws`.

The widget gets one global activation shortcut via Plasma (configurable in System Settings → Shortcuts → search "Aorus").
