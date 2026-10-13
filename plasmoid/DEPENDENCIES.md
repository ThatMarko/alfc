# ALFC Plasmoid Dependencies

## Required Runtime Dependencies

The plasmoid requires KDE Plasma 6 and the QtWebSockets QML module.

### Package Names by Distribution

| Dependency         | Arch              | Fedora              | Ubuntu/Debian (24.04+)         | openSUSE                  |
| ------------------ | ----------------- | ------------------- | ------------------------------ | ------------------------- |
| KDE Plasma 6       | `plasma-desktop`  | `plasma-desktop`    | `kde-plasma-desktop`           | `plasma6-desktop`         |
| Qt6 WebSockets QML | `qt6-websockets`  | `qt6-qtwebsockets`  | `qml6-module-qtwebsockets`     | `qt6-websockets-imports`  |
| Qt6 QML Base       | `qt6-declarative` | `qt6-qtdeclarative` | `qml6-module-qtquick`          | `qt6-declarative-imports` |
| Kirigami           | `kirigami`        | `kf6-kirigami`      | `qml6-module-org-kde-kirigami` | `kf6-kirigami-imports`    |

### Checking Dependencies

```bash
# Validate QML syntax and imports (or preview with plasmoidviewer -a plasmoid/package)
qmllint plasmoid/package/contents/ui/*.qml
```

### Missing Dependency Behavior

If `QtWebSockets` QML module is missing:

- The plasmoid will fail to load with a QML import error
- Plasma will show a broken applet placeholder
- Check `journalctl --user -t plasmashell` for the specific missing module

If `org.kde.plasma.components` is missing:

- This typically means Plasma 6 runtime is not properly installed
- The plasmoid requires a full Plasma 6 desktop environment

### Optional Dependencies

Graphical fan curve visualization is built directly into the widget using standard **QtQuick `Canvas`** (part of `qt6-declarative`), requiring **zero extra chart libraries** (such as `qt6-charts`).
