# Plasma widget dependencies

## Installed widget

The widget requires a **Linux Plasma 6 session**, Qt 6 QML modules, and a running ALFC backend with protocol **1.1 or a newer major-1 minor version**. The package metadata declares Plasma `6.0` as its minimum API. Headless component checks have run with Qt `6.8.2` and Plasma `6.3.5`; complete shell compatibility still needs validation on the oldest supported and a current Plasma release.

Required imports are:

| Import                                                                | Provider/purpose                                                                             |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `QtQuick`, `QtQuick.Controls`, `QtQuick.Templates`, `QtQuick.Layouts` | Qt Declarative/Quick Controls: input, validators, layout, and Canvas.                        |
| `QtWebSockets`                                                        | Qt WebSockets QML plugin for the service connection.                                         |
| `org.kde.kirigami`                                                    | Kirigami forms, icons, theme, units, actions, and inline feedback.                           |
| `org.kde.plasma.components`, `.core`, `.extras`                       | Plasma controls, menus, headings, and representations.                                       |
| `org.kde.plasma.plasmoid`, `.configuration`                           | Applet and configuration APIs supplied by Plasma. Some types register only inside the shell. |

A complete Plasma 6 desktop normally supplies the Plasma, Kirigami, KConfig, and SVG dependencies. A minimal Qt installation does not. The graph uses QtQuick `Canvas`; Qt Charts and Qt Graphs are not needed. The installed applet needs no Python, PySide6, QtTest, Node.js, or Bun runtime. The separately running ALFC service has its own native/kernel/elevation prerequisites.

### Distribution packages

Package names vary by distribution and release. These are the relevant Qt/KDE package families; verify that the installed desktop is Plasma 6 rather than a Plasma 5 package with a similar name.

| Component      | Arch              | Fedora              | Debian 13 / Ubuntu with Plasma 6                                                     | openSUSE                  |
| -------------- | ----------------- | ------------------- | ------------------------------------------------------------------------------------ | ------------------------- |
| Plasma desktop | `plasma-desktop`  | `plasma-desktop`    | `kde-plasma-desktop`                                                                 | `plasma6-desktop`         |
| WebSockets QML | `qt6-websockets`  | `qt6-qtwebsockets`  | `qml6-module-qtwebsockets`                                                           | `qt6-websockets-imports`  |
| Qt Declarative | `qt6-declarative` | `qt6-qtdeclarative` | `qml6-module-qtquick`, `qml6-module-qtquick-controls`, `qml6-module-qtquick-layouts` | `qt6-declarative-imports` |
| Kirigami       | `kirigami`        | `kf6-kirigami`      | `qml6-module-org-kde-kirigami`                                                       | `kf6-kirigami-imports`    |

On Debian 13, `kpackagetool6` installs/upgrades/removes the package, and `plasma-sdk` supplies the development preview tools. `plasma-desktoptheme` provides the Plasma components used by the component tests. These package names and their Qt/KDE versions are available in the official [Debian package index](https://packages.debian.org/trixie/). Ubuntu 24.04's default Plasma 5 desktop does not meet this applet's requirement.

Run widget installation as the desktop user, not with `sudo`; see [README.md](README.md#installation-and-removal). Installing a widget does not install, start, or elevate the backend.

## Development checks

### Qt runtime tests

Use a Python virtual environment for development dependencies. The CI-tested PySide6 version is `6.8.2.1`:

```bash
python3 -m venv /tmp/alfc-widget-venv
/tmp/alfc-widget-venv/bin/python -m pip install PySide6==6.8.2.1
/tmp/alfc-widget-venv/bin/python plasmoid/run_qml_tests.py
```

On Debian/Ubuntu, the wheel still dynamically links `libEGL.so.1` and `libGL.so.1` through QtGui; install `libegl1` and `libgl1` even when using the software renderer. Standard font, X11, and xkbcommon libraries are also QtGui prerequisites and normally come from the desktop image. CI explicitly installs the EGL/GL loader packages before running the tests.

The runner sets `QT_QPA_PLATFORM=offscreen` and `QT_QUICK_BACKEND=software` by default and uses a temporary cache directory. This avoids requiring a display server or GPU. Existing environment overrides are respected when testing another platform/renderer. Qt documents this backend selection in its [scene-graph implementation](https://github.com/qt/qtdeclarative/blob/6.8/src/quick/scenegraph/qsgcontextplugin.cpp).

PySide's wheel contains its own Qt libraries and QML modules. To test the actual editor, make **matching** Plasma/Kirigami modules discoverable; mixing a different Qt build's private-ABI plugins can fail to load. For a matching Debian installation, for example:

```bash
QML_IMPORT_PATH=/usr/lib/x86_64-linux-gnu/qt6/qml \
  /tmp/alfc-widget-venv/bin/python plasmoid/run_qml_tests.py
```

Other distributions use paths such as `/usr/lib/qt6/qml` or `/usr/lib64/qt6/qml`. A Qt-only run explicitly skips editor cases when the Plasma import is absent. With matching Plasma modules present, editor loading/rendering/behavior must pass; other errors are not treated as successful coverage. These tests do not instantiate a complete Plasma shell or access fan hardware.

### Syntax and shell validation

From the repository root:

```bash
# Use the Qt 6 binary; its name/path varies by distribution.
/usr/lib/qt6/bin/qmllint plasmoid/package/contents/ui/*.qml
bash -n plasmoid/install.sh plasmoid/uninstall.sh
# Run in an actual Plasma 6 session for complete applet integration.
plasmoidviewer -a plasmoid/package
```

A generic `qmllint` executable can point at Qt 5; check its `--version` first. Standalone linting may report `PlasmoidItem`, attached `Plasmoid` APIs, and `PlasmaCore.Action` as unresolved because Plasma registers them at runtime. It can still identify syntax problems, but it does not replace a real shell preview. The repository's `bun run test` checks QML/TypeScript protocol parity without requiring KDE.

## Diagnosing failures

- A missing `QtWebSockets` plugin produces a QML import error and a broken applet; installing only the Qt C++ WebSockets library may not provide the QML plugin on split-package distributions.
- Missing `org.kde.plasma.components` or Kirigami imports indicate an incomplete or incompatible Plasma 6 QML installation. Inspect the specific import and loader errors instead of disabling validation.
- An `ImportError` for `libEGL.so.1` or `libGL.so.1` before the Python tests start is a native loader prerequisite failure, not a test skip.
- A connected widget still needs a valid supported state snapshot before commands are enabled. Protocol 1.0, invalid fields, and malformed curves are rejected.
- Stale telemetry, sensor errors, unconfirmed fan writes, and `restartRequired` are distinct conditions. Reconnecting does not restart the backend or recover a permanently failed native worker.

For installed applets, inspect Plasma's user-session logs, for example `journalctl --user -t plasmashell`, or start the preview from a terminal. Check that ALFC is running separately and that the configured `/ws` endpoint is reachable. Consult [README.md](README.md#configuration) for the development web-interface override and forwarded/proxy endpoints.
