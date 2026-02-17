# ALFC Plasmoid

This is the Plasma 6 widget for Aorus Laptop Fan Control.

**Note:** All commands below should be run from the `plasmoid/` directory.

## Installation

To install the plasmoid for the current user:

```bash
kpackagetool6 --type Plasma/Applet --install package
```

To upgrade:

```bash
kpackagetool6 --type Plasma/Applet --upgrade package
```

To uninstall:

```bash
kpackagetool6 --type Plasma/Applet --remove org.kde.alfc
```

## Testing

To view the plasmoid in a window (useful for development):

```bash
plasmoidviewer -a package
```

Or using `plasmawindowed`:

```bash
plasmawindowed org.kde.alfc
```

## Structure

- `package/metadata.json`: Plugin metadata (Plasma 6 format)
- `package/contents/ui/main.qml`: Main entry point
- `package/contents/ui/CompactRepresentation.qml`: Panel icon view
- `package/contents/ui/FullRepresentation.qml`: Popup view
- `package/contents/config/config.qml`: Configuration dialog structure
- `package/contents/config/main.xml`: KConfigXT schema
