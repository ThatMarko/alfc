import QtQuick
import QtQuick.Layouts
import org.kde.plasma.components as PlasmaComponents
import org.kde.plasma.plasmoid
import org.kde.kirigami as Kirigami

MouseArea {
    id: compactRoot

    required property var backend
    property bool inTray: false

    // Accessibility for screen readers
    Accessible.role: Accessible.Button
    Accessible.name: i18n("Aorus Fan Control")

    // System tray sets the size; in panel we need Layout hints
    Layout.fillHeight: true
    Layout.minimumWidth: inTray ? Kirigami.Units.iconSizes.medium : textLabel.implicitWidth + Kirigami.Units.smallSpacing * 2
    Layout.preferredWidth: Layout.minimumWidth

    hoverEnabled: true
    onClicked: root.expanded = !root.expanded

    // ── Icon Mode (System Tray) ────────────────────────────────────
    Kirigami.Icon {
        id: trayIcon
        anchors.fill: parent
        visible: compactRoot.inTray
        source: Plasmoid.icon
        active: compactRoot.containsMouse
    }

    // ── Text Mode (Panel) ──────────────────────────────────────────
    PlasmaComponents.Label {
        id: textLabel
        anchors.fill: parent
        visible: !compactRoot.inTray
        horizontalAlignment: Text.AlignHCenter
        verticalAlignment: Text.AlignVCenter
        text: {
            if (!backend || !backend.isConnected)
                return i18n("ALFC: --")
            if (!backend.latestActivity || Object.keys(backend.latestActivity).length === 0)
                return i18n("ALFC: ...")

            var cpu = backend.latestActivity.avgCPUTemp
            var gpu = backend.latestActivity.avgGPUTemp
            var fan = backend.latestActivity.appliedSpeed

            if (cpu === undefined || gpu === undefined)
                return i18n("ALFC: ...")

            if (backend.latestActivity.sensorFailure === true)
                return i18n("ALFC: sensor error")

            return i18n("%1°C / %2°C | %3%",
                Math.round(cpu), Math.round(gpu),
                fan != null ? Math.round(fan) : "--")
        }
    }
}
