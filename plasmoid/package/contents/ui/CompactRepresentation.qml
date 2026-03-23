pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Layouts

import org.kde.kirigami as Kirigami
import org.kde.plasma.components as PlasmaComponents
import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.plasmoid

Item {
    id: compactRoot

    required property var backend
    required property PlasmoidItem plasmoidItem
    property bool iconOnly: false
    property int warningTemp: 90

    readonly property bool hasState: backend != null && backend.hasState
    readonly property bool hasActivity: backend != null && backend.hasFreshActivity
    readonly property bool hasTelemetrySnapshot: backend != null && backend.hasActivity
    readonly property bool staleActivity: hasTelemetrySnapshot && !hasActivity
    readonly property int staleActivitySeconds: staleActivity
        ? Math.ceil(backend.activityAgeMs / 1000)
        : 0
    readonly property bool isConnecting: backend != null && backend.isConnecting
    readonly property bool isDisconnected: backend == null || !backend.isConnected
    readonly property bool protocolCompatible: backend == null
        || backend.protocolCompatible !== false
    readonly property string protocolVersion: backend != null
        && typeof backend.protocolVersion === "string"
        ? backend.protocolVersion
        : ""
    readonly property bool verticalPanel: Plasmoid.formFactor === PlasmaCore.Types.Vertical
        && !iconOnly
    readonly property int panelIconSize: Math.round(Kirigami.Units.gridUnit * 1.2)
    readonly property int compactPanelExtent: panelIconSize + Kirigami.Units.smallSpacing * 2
    readonly property int horizontalPanelPreferredWidth: Kirigami.Units.gridUnit * 12
    readonly property int horizontalPanelPreferredHeight: compactPanelExtent
    readonly property int verticalPanelPreferredWidth: compactPanelExtent
    readonly property int verticalPanelPreferredHeight: Kirigami.Units.gridUnit * 6
    readonly property int horizontalPanelDetailsWidth: Kirigami.Units.gridUnit * 9
    readonly property int verticalPanelDetailsHeight: Kirigami.Units.gridUnit * 6
    readonly property var safeState: hasState ? backend.latestState : ({
        doFixedSpeed: false,
        fixedPercentage: 0,
        isFanControlAvailable: true
    })
    readonly property var safeActivity: hasTelemetrySnapshot ? backend.latestActivity : ({
        avgCPUTemp: 0,
        avgGPUTemp: 0,
        appliedSpeed: null,
        target: 0
    })
    readonly property bool fixedModeEnabled: hasState
        && safeState.doFixedSpeed === true
    readonly property bool fanControlAvailable: hasState
        ? safeState.isFanControlAvailable !== false
        : true
    readonly property bool isWarning: hasTelemetrySnapshot
        && (Math.round(safeActivity.avgCPUTemp) >= warningTemp
            || Math.round(safeActivity.avgGPUTemp) >= warningTemp)
    readonly property bool showHorizontalPanelDetails: !iconOnly
        && !verticalPanel
        && width >= horizontalPanelDetailsWidth
    readonly property bool showVerticalPanelDetails: !iconOnly
        && verticalPanel
        && height >= verticalPanelDetailsHeight
    readonly property string primaryText: {
        if (isDisconnected) {
            return i18n("ALFC")
        }

        if (hasState && !protocolCompatible) {
            return i18n("Unsupported")
        }

        if (!hasTelemetrySnapshot) {
            return i18n("Waiting")
        }

        return i18n("%1°C / %2°C",
            Math.round(safeActivity.avgCPUTemp),
            Math.round(safeActivity.avgGPUTemp))
    }
    readonly property string secondaryText: {
        if (isDisconnected) {
            return isConnecting ? i18n("Connecting") : i18n("Offline")
        }

        if (!hasState) {
            return i18n("Syncing")
        }

        if (!protocolCompatible) {
            return i18n("Protocol %1", protocolVersion)
        }

        if (!fanControlAvailable) {
            return i18n("Unavailable")
        }

        if (staleActivity) {
            return i18n("Stale %1s", staleActivitySeconds)
        }

        if (fixedModeEnabled) {
            return i18n("Fixed %1%", safeState.fixedPercentage)
        }

        if (hasTelemetrySnapshot) {
            return i18n("Auto %1%", Math.round(safeActivity.target))
        }

        return i18n("Auto")
    }

    clip: true
    activeFocusOnTab: true

    Keys.onPressed: event => {
        compactRoot.handleKeyboardActivation(event)
    }

    Accessible.name: Plasmoid.title
    Accessible.description: plasmoidItem.toolTipSubText ?? ""
    Accessible.role: Accessible.Button
    Accessible.onPressAction: Plasmoid.activated()

    implicitWidth: iconOnly
        ? compactPanelExtent
        : (verticalPanel
            ? verticalPanelPreferredWidth
            : horizontalPanelPreferredWidth)
    implicitHeight: iconOnly
        ? compactPanelExtent
        : (verticalPanel
            ? verticalPanelPreferredHeight
            : horizontalPanelPreferredHeight)

    Layout.fillHeight: true
    Layout.minimumWidth: compactPanelExtent
    Layout.minimumHeight: compactPanelExtent
    Layout.preferredWidth: iconOnly
        ? compactPanelExtent
        : (verticalPanel
            ? verticalPanelPreferredWidth
            : horizontalPanelPreferredWidth)
    Layout.preferredHeight: iconOnly
        ? compactPanelExtent
        : (verticalPanel
            ? verticalPanelPreferredHeight
            : horizontalPanelPreferredHeight)
    Layout.maximumWidth: iconOnly
        ? compactPanelExtent
        : (verticalPanel
            ? verticalPanelPreferredWidth
            : horizontalPanelPreferredWidth)
    Layout.maximumHeight: iconOnly
        ? compactPanelExtent
        : (verticalPanel
            ? verticalPanelPreferredHeight
            : horizontalPanelPreferredHeight)

    function rememberExpansionState() {
        activationArea.wasExpanded = plasmoidItem.expanded
    }

    function handlePointerActivation(button) {
        if (button === Qt.MiddleButton) {
            Plasmoid.secondaryActivated()
            return
        }

        if (button === Qt.LeftButton) {
            plasmoidItem.expanded = !activationArea.wasExpanded
        }
    }

    function handleKeyboardActivation(event) {
        switch (event.key) {
        case Qt.Key_Space:
        case Qt.Key_Enter:
        case Qt.Key_Return:
        case Qt.Key_Select:
            Plasmoid.activated()
            event.accepted = true
            break
        }
    }

    Loader {
        id: contentLoader

        anchors.fill: parent
        sourceComponent: compactRoot.iconOnly
            ? iconOnlyComponent
            : (compactRoot.verticalPanel
                ? (compactRoot.showVerticalPanelDetails
                    ? verticalComponent
                    : iconOnlyComponent)
                : (compactRoot.showHorizontalPanelDetails
                    ? horizontalComponent
                    : iconOnlyComponent))
    }

    MouseArea {
        id: activationArea

        property bool wasExpanded: false

        anchors.fill: parent
        z: 100
        acceptedButtons: Qt.LeftButton | Qt.MiddleButton
        hoverEnabled: true
        preventStealing: true
        cursorShape: Qt.PointingHandCursor
        onPressedChanged: {
            if (pressed) {
                compactRoot.rememberExpansionState()
            }
        }
        onClicked: mouse => compactRoot.handlePointerActivation(mouse.button)
    }

    Loader {
        anchors.fill: parent

        active: compactRoot.plasmoidItem.expandedOnDragHover

        sourceComponent: DropArea {
            anchors.fill: parent

            onEntered: dropTimer.restart()
            onExited: dropTimer.stop()

            Timer {
                id: dropTimer

                interval: 250
                onTriggered: {
                    compactRoot.plasmoidItem.expanded = true
                    activationArea.wasExpanded = true
                }
            }
        }
    }

    Component {
        id: statusBadge

        Rectangle {
            width: Kirigami.Units.smallSpacing * 2
            height: width
            radius: width / 2
            color: compactRoot.isWarning
                || (compactRoot.hasState && !compactRoot.protocolCompatible)
                ? Kirigami.Theme.negativeTextColor
                : (compactRoot.staleActivity
                    ? Kirigami.Theme.neutralTextColor
                    : (compactRoot.isDisconnected
                    ? Kirigami.Theme.disabledTextColor
                    : Kirigami.Theme.positiveTextColor))
            border.width: 1
            border.color: Qt.alpha(Kirigami.Theme.backgroundColor, 0.85)
        }
    }

    Component {
        id: iconOnlyComponent

        Item {
            implicitWidth: compactRoot.panelIconSize
            implicitHeight: compactRoot.panelIconSize

            Kirigami.Icon {
                anchors.centerIn: parent
                width: compactRoot.panelIconSize
                height: compactRoot.panelIconSize
                source: Plasmoid.icon
                active: compactRoot.hasActivity || activationArea.containsMouse
            }

            Loader {
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.margins: -Kirigami.Units.smallSpacing / 3
                sourceComponent: statusBadge
            }
        }
    }

    Component {
        id: horizontalComponent

        Item {
            implicitWidth: row.implicitWidth + Kirigami.Units.smallSpacing * 2
            implicitHeight: row.implicitHeight + Kirigami.Units.smallSpacing * 2
            clip: true

            RowLayout {
                id: row

                anchors.fill: parent
                anchors.margins: Kirigami.Units.smallSpacing
                spacing: Kirigami.Units.smallSpacing

                Item {
                    Layout.preferredWidth: compactRoot.panelIconSize
                    Layout.preferredHeight: compactRoot.panelIconSize

                    Kirigami.Icon {
                        anchors.centerIn: parent
                        width: compactRoot.panelIconSize
                        height: compactRoot.panelIconSize
                        source: Plasmoid.icon
                        active: compactRoot.hasActivity
                            || activationArea.containsMouse
                    }

                    Loader {
                        anchors.right: parent.right
                        anchors.top: parent.top
                        anchors.margins: -Kirigami.Units.smallSpacing / 3
                        sourceComponent: statusBadge
                    }
                }

                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 0

                    PlasmaComponents.Label {
                        text: compactRoot.primaryText
                        font.bold: true
                        Layout.fillWidth: true
                        elide: Text.ElideRight
                    }

                    PlasmaComponents.Label {
                        text: compactRoot.secondaryText
                        color: compactRoot.isWarning
                            ? Kirigami.Theme.negativeTextColor
                            : Kirigami.Theme.disabledTextColor
                        font: Kirigami.Theme.smallFont
                        Layout.fillWidth: true
                        elide: Text.ElideRight
                    }
                }
            }
        }
    }

    Component {
        id: verticalComponent

        Item {
            implicitWidth: compactRoot.panelIconSize + Kirigami.Units.smallSpacing * 2
            implicitHeight: column.implicitHeight + Kirigami.Units.smallSpacing * 2
            clip: true

            ColumnLayout {
                id: column

                anchors.fill: parent
                anchors.margins: Kirigami.Units.smallSpacing
                spacing: 0

                Item {
                    Layout.alignment: Qt.AlignHCenter
                    Layout.preferredWidth: compactRoot.panelIconSize
                    Layout.preferredHeight: compactRoot.panelIconSize

                    Kirigami.Icon {
                        anchors.centerIn: parent
                        width: compactRoot.panelIconSize
                        height: compactRoot.panelIconSize
                        source: Plasmoid.icon
                        active: compactRoot.hasActivity
                            || activationArea.containsMouse
                    }

                    Loader {
                        anchors.right: parent.right
                        anchors.top: parent.top
                        anchors.margins: -Kirigami.Units.smallSpacing / 3
                        sourceComponent: statusBadge
                    }
                }

                PlasmaComponents.Label {
                    text: compactRoot.hasActivity
                        ? i18n("%1°C", Math.round(compactRoot.safeActivity.avgCPUTemp))
                        : compactRoot.primaryText
                    font.bold: true
                    horizontalAlignment: Text.AlignHCenter
                    Layout.fillWidth: true
                    elide: Text.ElideRight
                }

                PlasmaComponents.Label {
                    text: compactRoot.secondaryText
                    color: compactRoot.isWarning
                        ? Kirigami.Theme.negativeTextColor
                        : Kirigami.Theme.disabledTextColor
                    font: Kirigami.Theme.smallFont
                    horizontalAlignment: Text.AlignHCenter
                    Layout.fillWidth: true
                    elide: Text.ElideRight
                }
            }
        }
    }
}
