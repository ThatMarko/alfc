pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Layouts

import org.kde.kirigami as Kirigami
import org.kde.plasma.components as PlasmaComponents
import org.kde.plasma.plasmoid

Item {
    id: tooltipRoot

    required property var backend
    property int warningTemp: 90

    readonly property bool connected: backend != null && backend.isConnected
    readonly property bool hasState: backend != null && backend.hasState
    readonly property bool hasActivity: backend != null && backend.hasFreshActivity
    readonly property var safeState: hasState ? backend.latestState : ({
        doFixedSpeed: false,
        fixedPercentage: 0
    })
    readonly property var safeActivity: hasActivity ? backend.latestActivity : ({
        avgCPUTemp: 0,
        avgGPUTemp: 0,
        appliedSpeed: null,
        target: 0
    })

    function tempColor(value) {
        return value >= tooltipRoot.warningTemp
            ? Kirigami.Theme.negativeTextColor
            : Kirigami.Theme.textColor
    }

    implicitWidth: tooltipLayout.implicitWidth + Kirigami.Units.gridUnit * 2
    implicitHeight: tooltipLayout.implicitHeight + Kirigami.Units.gridUnit

    ColumnLayout {
        id: tooltipLayout

        anchors.fill: parent
        anchors.margins: Kirigami.Units.largeSpacing
        spacing: Kirigami.Units.largeSpacing

        RowLayout {
            Layout.fillWidth: true

            Kirigami.Icon {
                source: Plasmoid.icon
                implicitWidth: Kirigami.Units.iconSizes.medium
                implicitHeight: Kirigami.Units.iconSizes.medium
            }

            ColumnLayout {
                Layout.fillWidth: true
                spacing: 0

                PlasmaComponents.Label {
                    text: i18n("Aorus Laptop Fan Control")
                    font.bold: true
                    Layout.fillWidth: true
                    elide: Text.ElideRight
                }

                PlasmaComponents.Label {
                    text: !tooltipRoot.connected
                        ? i18n("Disconnected")
                        : (tooltipRoot.hasActivity
                            ? i18n("Live telemetry")
                            : i18n("Connected, waiting for telemetry"))
                    color: !tooltipRoot.connected
                        ? Kirigami.Theme.negativeTextColor
                        : Kirigami.Theme.positiveTextColor
                    font: Kirigami.Theme.smallFont
                    Layout.fillWidth: true
                    elide: Text.ElideRight
                }
            }
        }

        GridLayout {
            columns: 2
            columnSpacing: Kirigami.Units.mediumSpacing
            rowSpacing: Kirigami.Units.mediumSpacing
            Layout.fillWidth: true

            MetricTile {
                label: i18n("CPU")
                value: tooltipRoot.hasActivity
                    ? i18n("%1\u00B0C", Math.round(tooltipRoot.safeActivity.avgCPUTemp))
                    : "--"
                valueColor: tooltipRoot.hasActivity
                    ? tooltipRoot.tempColor(
                        Math.round(tooltipRoot.safeActivity.avgCPUTemp))
                    : Kirigami.Theme.disabledTextColor
            }

            MetricTile {
                label: i18n("GPU")
                value: tooltipRoot.hasActivity
                    ? i18n("%1\u00B0C", Math.round(tooltipRoot.safeActivity.avgGPUTemp))
                    : "--"
                valueColor: tooltipRoot.hasActivity
                    ? tooltipRoot.tempColor(
                        Math.round(tooltipRoot.safeActivity.avgGPUTemp))
                    : Kirigami.Theme.disabledTextColor
            }

            MetricTile {
                label: i18n("Mode")
                value: tooltipRoot.hasState
                    ? (tooltipRoot.safeState.doFixedSpeed
                        ? i18n("Fixed")
                        : i18n("Auto"))
                    : "--"
                subtitle: tooltipRoot.hasState
                    ? (tooltipRoot.safeState.doFixedSpeed
                        ? i18n("%1%", tooltipRoot.safeState.fixedPercentage)
                        : i18n("Curve control"))
                    : ""
            }

            MetricTile {
                label: i18n("Fan")
                value: tooltipRoot.hasActivity
                    ? (tooltipRoot.safeActivity.appliedSpeed != null
                        ? i18n("%1%", Math.round(tooltipRoot.safeActivity.appliedSpeed))
                        : i18n("Pending"))
                    : "--"
                subtitle: tooltipRoot.hasActivity
                    ? i18n("Target %1%", Math.round(tooltipRoot.safeActivity.target))
                    : ""
            }
        }

        PlasmaComponents.Label {
            visible: tooltipRoot.connected && !tooltipRoot.hasActivity
            text: i18n("Telemetry is refreshed automatically after reconnects and stays available in fixed mode.")
            color: Kirigami.Theme.disabledTextColor
            font: Kirigami.Theme.smallFont
            wrapMode: Text.WordWrap
            Layout.fillWidth: true
        }

        PlasmaComponents.Label {
            visible: tooltipRoot.backend != null && tooltipRoot.backend.lastError.length > 0
            text: tooltipRoot.backend.lastError
            color: Kirigami.Theme.disabledTextColor
            font: Kirigami.Theme.smallFont
            wrapMode: Text.WordWrap
            Layout.fillWidth: true
        }
    }
}
