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

    readonly property bool desktopMode: Plasmoid.formFactor === PlasmaCore.Types.Planar
    readonly property bool hasState: backend != null && backend.hasState
    readonly property bool hasActivity: backend != null && backend.hasFreshActivity
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
        && !desktopMode
    readonly property int panelIconSize: Math.round(Kirigami.Units.gridUnit * 1.2)
    readonly property int compactPanelExtent: panelIconSize + Kirigami.Units.smallSpacing * 2
    readonly property int horizontalPanelPreferredWidth: Kirigami.Units.gridUnit * 12
    readonly property int horizontalPanelPreferredHeight: compactPanelExtent
    readonly property int verticalPanelPreferredWidth: compactPanelExtent
    readonly property int verticalPanelPreferredHeight: Kirigami.Units.gridUnit * 6
    readonly property int defaultDesktopWidth: Kirigami.Units.gridUnit * 14
    readonly property int defaultDesktopHeight: Kirigami.Units.gridUnit * 9
    readonly property int horizontalPanelDetailsWidth: Kirigami.Units.gridUnit * 9
    readonly property int verticalPanelDetailsHeight: Kirigami.Units.gridUnit * 6
    readonly property var safeState: hasState ? backend.latestState : ({
        doFixedSpeed: false,
        fixedPercentage: draftFixedPercentage,
        gpuBoost: false,
        isGpuBoostAvailable: false,
        isCpuTuningAvailable: false,
        pl1: draftPl1,
        pl2: draftPl2
    })
    readonly property var safeActivity: hasActivity ? backend.latestActivity : ({
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
    readonly property bool isWarning: hasActivity
        && (Math.round(safeActivity.avgCPUTemp) >= warningTemp
            || Math.round(safeActivity.avgGPUTemp) >= warningTemp)
    readonly property bool showHorizontalPanelDetails: !desktopMode
        && !iconOnly
        && !verticalPanel
        && width >= horizontalPanelDetailsWidth
    readonly property bool showVerticalPanelDetails: !desktopMode
        && !iconOnly
        && verticalPanel
        && height >= verticalPanelDetailsHeight
    readonly property int desktopTier: {
        if (!desktopMode) {
            return -1
        }

        if (compactRoot.width >= Kirigami.Units.gridUnit * 24
                && compactRoot.height >= Kirigami.Units.gridUnit * 18) {
            return 3
        }

        if (compactRoot.width >= Kirigami.Units.gridUnit * 18
                && compactRoot.height >= Kirigami.Units.gridUnit * 12) {
            return 2
        }

        if (compactRoot.width >= Kirigami.Units.gridUnit * 12
                && compactRoot.height >= Kirigami.Units.gridUnit * 8) {
            return 1
        }

        return 0
    }
    readonly property string primaryText: {
        if (isDisconnected) {
            return i18n("ALFC")
        }

        if (hasState && !protocolCompatible) {
            return i18n("Unsupported")
        }

        if (!hasActivity) {
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

        if (fixedModeEnabled) {
            return i18n("Fixed %1%", safeState.fixedPercentage)
        }

        if (hasActivity) {
            return i18n("Auto %1%", Math.round(safeActivity.target))
        }

        return i18n("Auto")
    }

    property int draftFixedPercentage: 50
    property int draftPl1: 37
    property int draftPl2: 106
    property string pendingBoostRequestId: ""
    property string pendingFixedRequestId: ""
    property string pendingModeRequestId: ""
    property string pendingTuneRequestId: ""
    property string modeSelectionOverride: ""
    property string statusMessage: ""
    property string statusTone: ""
    readonly property bool activationEnabled: !desktopMode || desktopTier === 0
    readonly property string selectedMode: modeSelectionOverride.length > 0
        ? modeSelectionOverride
        : (fixedModeEnabled ? "fixed" : "auto")

    clip: !desktopMode
    activeFocusOnTab: activationEnabled

    Keys.onPressed: event => {
        compactRoot.handleKeyboardActivation(event)
    }

    Accessible.name: Plasmoid.title
    Accessible.description: plasmoidItem.toolTipSubText ?? ""
    Accessible.role: Accessible.Button

    implicitWidth: desktopMode
        ? Math.max(defaultDesktopWidth, contentLoader.implicitWidth)
        : (iconOnly
            ? compactPanelExtent
            : (verticalPanel
                ? verticalPanelPreferredWidth
                : horizontalPanelPreferredWidth))
    implicitHeight: desktopMode
        ? Math.max(defaultDesktopHeight, contentLoader.implicitHeight)
        : (iconOnly
            ? compactPanelExtent
            : (verticalPanel
                ? verticalPanelPreferredHeight
                : horizontalPanelPreferredHeight))

    Layout.fillHeight: true
    Layout.minimumWidth: desktopMode
        ? Kirigami.Units.gridUnit * 8
        : compactPanelExtent
    Layout.minimumHeight: desktopMode
        ? Kirigami.Units.gridUnit * 6
        : compactPanelExtent
    Layout.preferredWidth: desktopMode
        ? defaultDesktopWidth
        : (iconOnly
            ? compactPanelExtent
            : (verticalPanel
                ? verticalPanelPreferredWidth
                : horizontalPanelPreferredWidth))
    Layout.preferredHeight: desktopMode
        ? defaultDesktopHeight
        : (iconOnly
            ? compactPanelExtent
            : (verticalPanel
                ? verticalPanelPreferredHeight
                : horizontalPanelPreferredHeight))
    Layout.maximumWidth: desktopMode
        ? defaultDesktopWidth
        : (iconOnly
            ? compactPanelExtent
            : (verticalPanel
                ? verticalPanelPreferredWidth
                : horizontalPanelPreferredWidth))
    Layout.maximumHeight: desktopMode
        ? defaultDesktopHeight
        : (iconOnly
            ? compactPanelExtent
            : (verticalPanel
                ? verticalPanelPreferredHeight
                : horizontalPanelPreferredHeight))

    function syncDrafts() {
        if (!hasState) {
            modeSelectionOverride = ""
            return
        }

        syncModeSelection()

        if (pendingFixedRequestId.length === 0) {
            draftFixedPercentage = safeState.fixedPercentage
        }

        if (pendingTuneRequestId.length === 0) {
            draftPl1 = safeState.pl1
            draftPl2 = safeState.pl2
        }
    }

    function syncModeSelection() {
        if (!hasState) {
            modeSelectionOverride = ""
            return
        }

        if (modeSelectionOverride === "fixed" && fixedModeEnabled) {
            modeSelectionOverride = ""
        } else if (modeSelectionOverride === "auto" && !fixedModeEnabled) {
            modeSelectionOverride = ""
        }
    }

    function requestMode(mode) {
        if (!hasState || !protocolCompatible || !fanControlAvailable
                || pendingModeRequestId.length > 0) {
            return
        }

        modeSelectionOverride = mode
        pendingModeRequestId = backend.setFixedMode(mode === "fixed")
    }

    function openFullControls() {
        if (!plasmoidItem.expanded) {
            plasmoidItem.expanded = true
        }
    }

    function rememberExpansionState() {
        activationArea.wasExpanded = plasmoidItem.expanded
    }

    function handlePointerActivation(button) {
        if (!activationEnabled) {
            return
        }

        if (button === Qt.MiddleButton) {
            Plasmoid.secondaryActivated()
            return
        }

        if (button === Qt.LeftButton) {
            plasmoidItem.expanded = !activationArea.wasExpanded
        }
    }

    function handleKeyboardActivation(event) {
        if (!activationEnabled) {
            return
        }

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

    function setStatus(message, tone) {
        statusMessage = message
        statusTone = tone

        if (tone === "success") {
            statusTimer.restart()
        } else {
            statusTimer.stop()
        }
    }

    Connections {
        target: backend

        function onLatestStateChanged() {
            compactRoot.syncDrafts()
        }

        function onRequestFinished(requestId, ok, errorMessage, _message) {
            if (requestId === compactRoot.pendingModeRequestId) {
                compactRoot.pendingModeRequestId = ""
                if (!ok) {
                    compactRoot.modeSelectionOverride = ""
                }
                compactRoot.setStatus(
                    ok
                        ? i18n("Mode updated")
                        : (errorMessage.length > 0
                            ? i18n("Failed to update mode: %1", errorMessage)
                            : i18n("Failed to update mode")),
                    ok ? "success" : "error"
                )
                return
            }

            if (requestId === compactRoot.pendingFixedRequestId) {
                compactRoot.pendingFixedRequestId = ""
                compactRoot.setStatus(
                    ok
                        ? i18n("Fixed speed saved")
                        : (errorMessage.length > 0
                            ? i18n("Failed to save fixed speed: %1", errorMessage)
                            : i18n("Failed to save fixed speed")),
                    ok ? "success" : "error"
                )
                return
            }

            if (requestId === compactRoot.pendingTuneRequestId) {
                compactRoot.pendingTuneRequestId = ""
                compactRoot.setStatus(
                    ok
                        ? i18n("CPU limits applied")
                        : (errorMessage.length > 0
                            ? i18n("Failed to apply CPU limits: %1", errorMessage)
                            : i18n("Failed to apply CPU limits")),
                    ok ? "success" : "error"
                )
                return
            }

            if (requestId === compactRoot.pendingBoostRequestId) {
                compactRoot.pendingBoostRequestId = ""
                compactRoot.setStatus(
                    ok
                        ? i18n("GPU boost updated")
                        : (errorMessage.length > 0
                            ? i18n("Failed to update GPU boost: %1", errorMessage)
                            : i18n("Failed to update GPU boost")),
                    ok ? "success" : "error"
                )
            }
        }
    }

    Component.onCompleted: compactRoot.syncDrafts()

    Timer {
        id: statusTimer

        interval: 2000
        onTriggered: {
            compactRoot.statusMessage = ""
            compactRoot.statusTone = ""
        }
    }

    Loader {
        id: contentLoader

        anchors.fill: parent
        sourceComponent: compactRoot.desktopMode
            ? desktopComponent
            : (compactRoot.iconOnly
                ? iconOnlyComponent
                : (compactRoot.verticalPanel
                    ? (compactRoot.showVerticalPanelDetails
                        ? verticalComponent
                        : iconOnlyComponent)
                    : (compactRoot.showHorizontalPanelDetails
                        ? horizontalComponent
                        : iconOnlyComponent)))
    }

    MouseArea {
        id: activationArea

        property bool wasExpanded: false

        anchors.fill: parent
        z: 100
        enabled: compactRoot.activationEnabled
        hoverEnabled: false
        preventStealing: true
        cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
        onPressedChanged: {
            if (pressed) {
                compactRoot.rememberExpansionState()
            }
        }
        onClicked: mouse => compactRoot.handlePointerActivation(mouse.button)
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
                : (compactRoot.isDisconnected
                    ? Kirigami.Theme.disabledTextColor
                    : Kirigami.Theme.positiveTextColor)
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
                active: compactRoot.hasActivity
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

    Component {
        id: desktopComponent

        Item {
            id: desktopRoot

            clip: true

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: Kirigami.Units.smallSpacing
                spacing: Kirigami.Units.smallSpacing

                Item {
                    Layout.fillWidth: true
                    implicitHeight: overviewCard.implicitHeight

                    SectionCard {
                        id: overviewCard

                        anchors.fill: parent
                        title: i18n("Aorus Laptop Fan Control")
                        subtitle: compactRoot.isDisconnected
                            ? (compactRoot.isConnecting
                                ? i18n("Connecting")
                                : i18n("Disconnected"))
                            : (compactRoot.hasActivity
                                ? i18n("Live overview")
                                : i18n("Connected, waiting for telemetry"))

                        GridLayout {
                            columns: compactRoot.desktopTier >= 2 ? 4 : 2
                            columnSpacing: Kirigami.Units.mediumSpacing
                            rowSpacing: Kirigami.Units.mediumSpacing
                            Layout.fillWidth: true

                            MetricTile {
                                label: i18n("CPU")
                                value: compactRoot.hasActivity
                                    ? i18n("%1°C", Math.round(compactRoot.safeActivity.avgCPUTemp))
                                    : "--"
                                valueColor: compactRoot.hasActivity
                                        && compactRoot.safeActivity.avgCPUTemp >= compactRoot.warningTemp
                                    ? Kirigami.Theme.negativeTextColor
                                    : Kirigami.Theme.textColor
                            }

                            MetricTile {
                                label: i18n("GPU")
                                value: compactRoot.hasActivity
                                    ? i18n("%1°C", Math.round(compactRoot.safeActivity.avgGPUTemp))
                                    : "--"
                                valueColor: compactRoot.hasActivity
                                        && compactRoot.safeActivity.avgGPUTemp >= compactRoot.warningTemp
                                    ? Kirigami.Theme.negativeTextColor
                                    : Kirigami.Theme.textColor
                            }

                            MetricTile {
                                label: i18n("Fan")
                                value: compactRoot.hasActivity
                                    ? (compactRoot.safeActivity.appliedSpeed != null
                                        ? i18n("%1%", Math.round(compactRoot.safeActivity.appliedSpeed))
                                        : i18n("Pending"))
                                    : (compactRoot.fixedModeEnabled
                                        ? i18n("%1%", compactRoot.safeState.fixedPercentage)
                                        : "--")
                                subtitle: compactRoot.hasActivity
                                    ? i18n("Target %1%", Math.round(compactRoot.safeActivity.target))
                                    : ""
                            }

                            MetricTile {
                                label: i18n("Mode")
                                value: compactRoot.hasState
                                    ? (compactRoot.protocolCompatible
                                        ? (compactRoot.fixedModeEnabled
                                            ? i18n("Fixed")
                                            : i18n("Auto"))
                                        : i18n("Unsupported"))
                                    : "--"
                                subtitle: compactRoot.hasState
                                    ? (compactRoot.protocolCompatible
                                        ? (compactRoot.fixedModeEnabled
                                            ? i18n("Stored speed %1%",
                                                compactRoot.safeState.fixedPercentage)
                                            : i18n("Curve control"))
                                        : i18n("Protocol %1",
                                            compactRoot.protocolVersion))
                                    : ""
                            }
                        }

                        PlasmaComponents.Label {
                            visible: compactRoot.desktopTier === 0
                            text: i18n("Click to open full controls.")
                            color: Kirigami.Theme.disabledTextColor
                            font: Kirigami.Theme.smallFont
                            Layout.fillWidth: true
                            horizontalAlignment: Text.AlignHCenter
                        }
                    }
                }

                SectionCard {
                    visible: compactRoot.desktopTier >= 1
                    title: i18n("Quick Control")
                    subtitle: i18n("Resize the widget larger or click to open the full editor.")

                    RowLayout {
                        visible: compactRoot.fanControlAvailable
                        Layout.fillWidth: true
                        spacing: Kirigami.Units.smallSpacing

                        PlasmaComponents.Button {
                            text: i18n("Auto")
                            highlighted: compactRoot.selectedMode === "auto"
                            enabled: compactRoot.hasState
                                && compactRoot.protocolCompatible
                                && compactRoot.fanControlAvailable
                                && compactRoot.pendingModeRequestId.length === 0
                            Layout.fillWidth: true
                            onClicked: compactRoot.requestMode("auto")
                        }

                        PlasmaComponents.Button {
                            text: i18n("Fixed")
                            highlighted: compactRoot.selectedMode === "fixed"
                            enabled: compactRoot.hasState
                                && compactRoot.protocolCompatible
                                && compactRoot.fanControlAvailable
                                && compactRoot.pendingModeRequestId.length === 0
                            Layout.fillWidth: true
                            onClicked: compactRoot.requestMode("fixed")
                        }
                    }

                    PlasmaComponents.Label {
                        visible: !compactRoot.fanControlAvailable
                        text: i18n("Fan control is not available on this system.")
                        color: Kirigami.Theme.disabledTextColor
                        font: Kirigami.Theme.smallFont
                        wrapMode: Text.WordWrap
                        Layout.fillWidth: true
                    }

                    RowLayout {
                        visible: compactRoot.fanControlAvailable
                        Layout.fillWidth: true
                        spacing: Kirigami.Units.smallSpacing

                        PlasmaComponents.Label {
                            text: i18n("Fixed speed")
                            Layout.preferredWidth: Kirigami.Units.gridUnit * 6
                        }

                        PlasmaComponents.Slider {
                            id: fixedSpeedSlider

                            Layout.fillWidth: true
                            from: 0
                            to: 100
                            stepSize: 1
                            enabled: compactRoot.hasState
                                && compactRoot.protocolCompatible
                                && compactRoot.fanControlAvailable
                                && compactRoot.pendingFixedRequestId.length === 0

                            Binding on value {
                                value: compactRoot.draftFixedPercentage
                                when: !fixedSpeedSlider.pressed
                                restoreMode: Binding.RestoreBinding
                            }

                            onMoved: compactRoot.draftFixedPercentage = Math.round(value)
                        }

                        PlasmaComponents.TextField {
                            id: fixedSpeedField

                            Layout.preferredWidth: Kirigami.Units.gridUnit * 4
                            horizontalAlignment: Text.AlignHCenter
                            validator: IntValidator {
                                bottom: 0
                                top: 100
                            }

                            Binding on text {
                                value: compactRoot.draftFixedPercentage.toString()
                                when: !fixedSpeedField.activeFocus
                                restoreMode: Binding.RestoreBinding
                            }

                            onEditingFinished: {
                                const value = parseInt(text)
                                if (!Number.isNaN(value)) {
                                    compactRoot.draftFixedPercentage =
                                        Math.max(0, Math.min(100, value))
                                }
                            }
                        }

                        PlasmaComponents.Button {
                            text: compactRoot.pendingFixedRequestId.length > 0
                                ? i18n("Saving...")
                                : i18n("Apply")
                            enabled: compactRoot.hasState
                                && compactRoot.protocolCompatible
                                && compactRoot.fanControlAvailable
                                && compactRoot.pendingFixedRequestId.length === 0
                            onClicked: compactRoot.pendingFixedRequestId =
                                compactRoot.backend.setFixedPercentage(
                                    compactRoot.draftFixedPercentage)
                        }
                    }
                }

                SectionCard {
                    visible: compactRoot.desktopTier >= 2
                    title: i18n("Advanced")
                    subtitle: i18n("Extra controls appear only when the backend reports support.")

                    RowLayout {
                        visible: compactRoot.hasState
                            && compactRoot.protocolCompatible
                            && compactRoot.safeState.isGpuBoostAvailable === true
                        Layout.fillWidth: true

                        PlasmaComponents.Label {
                            text: i18n("GPU boost")
                            Layout.fillWidth: true
                        }

                        PlasmaComponents.Switch {
                            checked: compactRoot.hasState
                                && compactRoot.safeState.gpuBoost === true
                            enabled: compactRoot.pendingBoostRequestId.length === 0
                            onClicked: {
                                compactRoot.pendingBoostRequestId =
                                    compactRoot.backend.setGpuBoost(checked)
                            }
                        }
                    }

                    RowLayout {
                        visible: compactRoot.fanControlAvailable
                            && compactRoot.hasState
                            && compactRoot.protocolCompatible
                            && compactRoot.safeState.isCpuTuningAvailable === true
                        Layout.fillWidth: true
                        spacing: Kirigami.Units.smallSpacing

                        PlasmaComponents.Label {
                            text: i18n("PL1")
                            Layout.preferredWidth: Kirigami.Units.gridUnit * 3
                        }

                        PlasmaComponents.TextField {
                            id: pl1Field

                            Layout.fillWidth: true
                            validator: IntValidator {
                                bottom: 0
                                top: 200
                            }

                            Binding on text {
                                value: compactRoot.draftPl1.toString()
                                when: !pl1Field.activeFocus
                                restoreMode: Binding.RestoreBinding
                            }

                            onEditingFinished: {
                                const value = parseInt(text)
                                if (!Number.isNaN(value)) {
                                    compactRoot.draftPl1 = value
                                }
                            }
                        }

                        PlasmaComponents.Label {
                            text: i18n("PL2")
                            Layout.preferredWidth: Kirigami.Units.gridUnit * 3
                        }

                        PlasmaComponents.TextField {
                            id: pl2Field

                            Layout.fillWidth: true
                            validator: IntValidator {
                                bottom: 0
                                top: 200
                            }

                            Binding on text {
                                value: compactRoot.draftPl2.toString()
                                when: !pl2Field.activeFocus
                                restoreMode: Binding.RestoreBinding
                            }

                            onEditingFinished: {
                                const value = parseInt(text)
                                if (!Number.isNaN(value)) {
                                    compactRoot.draftPl2 = value
                                }
                            }
                        }

                        PlasmaComponents.Button {
                            text: compactRoot.pendingTuneRequestId.length > 0
                                ? i18n("Applying...")
                                : i18n("Apply")
                            enabled: compactRoot.fanControlAvailable
                                && compactRoot.protocolCompatible
                                && compactRoot.pendingTuneRequestId.length === 0
                            onClicked: compactRoot.pendingTuneRequestId =
                                compactRoot.backend.applyTune(
                                    compactRoot.draftPl1,
                                    compactRoot.draftPl2)
                        }
                    }
                }

                SectionCard {
                    visible: compactRoot.desktopTier >= 3
                        && compactRoot.fanControlAvailable
                    title: i18n("Fan Curves")
                    subtitle: i18n("Large desktop widgets can expose direct curve editing.")

                    FanTableEditor {
                        backend: compactRoot.backend
                        Layout.fillWidth: true
                        Layout.minimumHeight: Kirigami.Units.gridUnit * 11
                    }
                }

                RowLayout {
                    visible: compactRoot.desktopTier >= 1
                    Layout.fillWidth: true

                    PlasmaComponents.Label {
                        visible: compactRoot.statusMessage.length > 0
                        text: compactRoot.statusMessage
                        color: compactRoot.statusTone === "error"
                            ? Kirigami.Theme.negativeTextColor
                            : (compactRoot.statusTone === "success"
                                ? Kirigami.Theme.positiveTextColor
                                : Kirigami.Theme.disabledTextColor)
                        font: Kirigami.Theme.smallFont
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                    }

                    PlasmaComponents.Button {
                        text: i18n("Full Controls")
                        onClicked: compactRoot.openFullControls()
                    }
                }
            }
        }
    }
}
