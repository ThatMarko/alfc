import QtQuick
import QtQuick.Layouts
import org.kde.plasma.components as PlasmaComponents
import org.kde.kirigami as Kirigami

Item {
    id: tooltipRoot

    required property var backend

    // Use same threshold as main.qml (90°C)
    readonly property int warningTemp: 90

    implicitWidth: tooltipLayout.implicitWidth + Kirigami.Units.gridUnit * 2
    implicitHeight: tooltipLayout.implicitHeight + Kirigami.Units.gridUnit

    ColumnLayout {
        id: tooltipLayout
        anchors.centerIn: parent
        spacing: Kirigami.Units.smallSpacing

        // Title row with icon
        RowLayout {
            spacing: Kirigami.Units.smallSpacing

            Kirigami.Icon {
                source: "computer-laptop"
                implicitWidth: Kirigami.Units.iconSizes.medium
                implicitHeight: Kirigami.Units.iconSizes.medium
            }

            PlasmaComponents.Label {
                text: i18n("Aorus Fan Control")
                font.bold: true
            }
        }

        // Status indicator
        PlasmaComponents.Label {
            text: backend && backend.isConnected ? i18n("Connected") : i18n("Disconnected")
            color: backend && backend.isConnected
                ? Kirigami.Theme.positiveTextColor
                : Kirigami.Theme.negativeTextColor
            font.pointSize: Kirigami.Theme.smallFont.pointSize
        }

        // Temperature grid (only when data available)
        GridLayout {
            columns: 2
            columnSpacing: Kirigami.Units.largeSpacing
            rowSpacing: Kirigami.Units.smallSpacing
            visible: backend && backend.isConnected
                && backend.latestActivity != null
                && backend.latestActivity.avgCPUTemp !== undefined

            PlasmaComponents.Label {
                text: i18n("CPU:")
                font.bold: true
            }
            PlasmaComponents.Label {
                text: backend && backend.latestActivity != null
                    ? i18n("%1\u00B0C", Math.round(backend.latestActivity.avgCPUTemp))
                    : "--"
                color: backend && backend.latestActivity != null && backend.latestActivity.avgCPUTemp >= tooltipRoot.warningTemp
                    ? Kirigami.Theme.negativeTextColor
                    : Kirigami.Theme.textColor
            }

            PlasmaComponents.Label {
                text: i18n("GPU:")
                font.bold: true
            }
            PlasmaComponents.Label {
                text: backend && backend.latestActivity != null
                    ? i18n("%1\u00B0C", Math.round(backend.latestActivity.avgGPUTemp))
                    : "--"
                color: backend && backend.latestActivity != null && backend.latestActivity.avgGPUTemp >= tooltipRoot.warningTemp
                    ? Kirigami.Theme.negativeTextColor
                    : Kirigami.Theme.textColor
            }

            PlasmaComponents.Label {
                text: i18n("Fan:")
                font.bold: true
            }
            PlasmaComponents.Label {
                text: backend && backend.latestActivity != null && backend.latestActivity.appliedSpeed != null
                    ? i18n("%1%", Math.round(backend.latestActivity.appliedSpeed))
                    : "--"
            }

            PlasmaComponents.Label {
                text: i18n("Mode:")
                font.bold: true
            }
            PlasmaComponents.Label {
                text: backend && backend.latestState != null && backend.latestState.doFixedSpeed !== undefined
                    ? (backend.latestState.doFixedSpeed ? i18n("Fixed") : i18n("Curve"))
                    : "--"
            }
        }
    }
}
