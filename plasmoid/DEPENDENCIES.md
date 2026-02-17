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
# Check if QtWebSockets QML module is available
qml6 -e 'import QtWebSockets; Qt.quit()'

# Check if Plasma components are available
qml6 -e 'import org.kde.plasma.components; Qt.quit()'
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

| Dependency   | Purpose                      | Arch         | Fedora         |
| ------------ | ---------------------------- | ------------ | -------------- |
| `qt6-charts` | Future: graphical fan curves | `qt6-charts` | `qt6-qtcharts` |

Charts module is NOT required for v1. The fan table uses numeric editing only.
