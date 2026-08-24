pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts

import org.kde.kirigami as Kirigami
import org.kde.plasma.components as PlasmaComponents
import org.kde.plasma.extras as PlasmaExtras
import org.kde.plasma.plasmoid

PlasmaExtras.Representation {
    id: fullRoot

    required property var backend
    required property string webUiUrl
    required property bool isPlanar
    required property int warningTemp

    readonly property bool connected: backend != null && backend.isConnected
    readonly property bool connecting: backend != null && backend.isConnecting
    readonly property bool hasState: backend != null && backend.hasState
    readonly property bool hasActivity: backend != null && backend.hasFreshActivity
    readonly property bool hasTelemetrySnapshot: backend != null && backend.hasActivity
    readonly property bool staleActivity: hasTelemetrySnapshot
        && !backend.hasFreshActivity
    readonly property int staleActivitySeconds: staleActivity
        ? Math.ceil(backend.activityAgeMs / 1000)
        : 0
    readonly property bool protocolCompatible: backend == null
        || backend.protocolCompatible !== false
    readonly property string protocolVersion: backend != null
        && typeof backend.protocolVersion === "string"
        ? backend.protocolVersion
        : ""
    readonly property string connectionSummaryText: {
        if (!connected) {
            return connecting
                ? i18n("Connecting")
                : i18n("Disconnected")
        }

        if (!hasState) {
            return i18n("Connected, waiting for state")
        }

        if (!protocolCompatible) {
            return i18n("Unsupported backend protocol %1",
                protocolVersion)
        }

        if (hasActivity) {
            return i18n("Live telemetry")
        }

        if (staleActivity) {
            return i18n("Telemetry stale")
        }

        return i18n("Connected, waiting for telemetry")
    }
    readonly property var state: hasState ? backend.latestState : null
    readonly property var activity: hasTelemetrySnapshot
        ? backend.latestActivity
        : null
    readonly property var safeState: hasState ? backend.latestState : ({
        doFixedSpeed: false,
        fixedPercentage: draftFixedPercentage,
        gpuBoost: false,
        isGpuBoostAvailable: false,
        isCpuTuningAvailable: false,
        pl1: draftPl1,
        pl2: draftPl2
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
    readonly property bool modeBusy: pendingModeRequestId.length > 0
    readonly property bool fixedBusy: pendingFixedRequestId.length > 0
    readonly property bool boostBusy: pendingBoostRequestId.length > 0
    readonly property bool tuningBusy: pendingTuneRequestId.length > 0
    readonly property bool canSyncFixedDraft: !speedSlider.pressed
        && !speedField.activeFocus
        && !fixedBusy
    readonly property bool canSyncPl1Draft: !pl1Field.activeFocus
        && !tuningBusy
    readonly property bool canSyncPl2Draft: !pl2Field.activeFocus
        && !tuningBusy
    readonly property string selectedMode: modeSelectionOverride.length > 0
        ? modeSelectionOverride
        : (fixedModeEnabled ? "fixed" : "auto")
    readonly property color connectionSummaryColor: {
        if (!connected) {
            return connecting
                ? Kirigami.Theme.disabledTextColor
                : Kirigami.Theme.negativeTextColor
        }

        if (!hasState || !protocolCompatible) {
            return Kirigami.Theme.negativeTextColor
        }

        if (hasActivity) {
            return Kirigami.Theme.positiveTextColor
        }

        if (staleActivity) {
            return Kirigami.Theme.neutralTextColor
        }

        return Kirigami.Theme.disabledTextColor
    }

    property int draftFixedPercentage: 50
    property int draftPl1: 37
    property int draftPl2: 106
    property string pendingModeRequestId: ""
    property string pendingFixedRequestId: ""
    property string pendingBoostRequestId: ""
    property string pendingTuneRequestId: ""
    property string modeSelectionOverride: ""
    property string feedbackText: ""
    property string feedbackTone: ""

    collapseMarginsHint: true
    Layout.minimumWidth: Kirigami.Units.gridUnit * (isPlanar ? 30 : 24)
    Layout.minimumHeight: Kirigami.Units.gridUnit * (isPlanar ? 30 : 24)
    Layout.preferredWidth: Kirigami.Units.gridUnit * (isPlanar ? 34 : 26)
    Layout.preferredHeight: Kirigami.Units.gridUnit * (isPlanar ? 36 : 30)

    function tempColor(value) {
        if (value >= fullRoot.warningTemp) {
            return Kirigami.Theme.negativeTextColor
        }
        if (value >= fullRoot.warningTemp - 10) {
            return Kirigami.Theme.neutralTextColor
        }
        return Kirigami.Theme.textColor
    }

    function setFeedback(message, tone) {
        fullRoot.feedbackText = message
        fullRoot.feedbackTone = tone

        if (tone === "success") {
            feedbackTimer.restart()
        } else {
            feedbackTimer.stop()
        }
    }

    function syncDraftsFromState() {
        if (!fullRoot.hasState) {
            fullRoot.modeSelectionOverride = ""
            return
        }

        fullRoot.syncModeSelection()

        if (fullRoot.canSyncFixedDraft && typeof fullRoot.safeState.fixedPercentage === "number") {
            fullRoot.draftFixedPercentage = fullRoot.safeState.fixedPercentage
        }

        if (fullRoot.canSyncPl1Draft && typeof fullRoot.safeState.pl1 === "number") {
            fullRoot.draftPl1 = fullRoot.safeState.pl1
        }

        if (fullRoot.canSyncPl2Draft && typeof fullRoot.safeState.pl2 === "number") {
            fullRoot.draftPl2 = fullRoot.safeState.pl2
        }
    }

    function syncModeSelection() {
        if (!fullRoot.hasState) {
            fullRoot.modeSelectionOverride = ""
            return
        }

        if (fullRoot.modeSelectionOverride === "fixed"
                && fullRoot.fixedModeEnabled) {
            fullRoot.modeSelectionOverride = ""
        } else if (fullRoot.modeSelectionOverride === "auto"
                && !fullRoot.fixedModeEnabled) {
            fullRoot.modeSelectionOverride = ""
        }
    }

    function requestMode(mode) {
        if (!fullRoot.hasState || !fullRoot.fanControlAvailable
                || fullRoot.modeBusy) {
            return
        }

        fullRoot.modeSelectionOverride = mode
        fullRoot.pendingModeRequestId =
            fullRoot.backend.setFixedMode(mode === "fixed")
    }

    function abortPendingRequests() {
        const hadPending = fullRoot.modeBusy
            || fullRoot.fixedBusy
            || fullRoot.boostBusy
            || fullRoot.tuningBusy

        if (!hadPending) {
            return
        }

        fullRoot.pendingModeRequestId = ""
        fullRoot.pendingFixedRequestId = ""
        fullRoot.pendingBoostRequestId = ""
        fullRoot.pendingTuneRequestId = ""
        fullRoot.modeSelectionOverride = ""
        fullRoot.setFeedback(
            i18n("Connection lost before the previous request completed."),
            "error")
    }

    QQC2.ButtonGroup {
        id: modeButtonGroup
    }

    header: WidgetHeading {
        webUiUrl: fullRoot.webUiUrl
    }

    Timer {
        id: feedbackTimer

        interval: 2500
        onTriggered: {
            fullRoot.feedbackText = ""
            fullRoot.feedbackTone = ""
        }
    }

    Connections {
        target: fullRoot.backend

        function onLatestStateChanged() {
            fullRoot.syncDraftsFromState()
        }

        function onIsConnectedChanged() {
            if (!fullRoot.connected) {
                fullRoot.abortPendingRequests()
            }
        }

        function onRequestFinished(requestId, ok, errorMessage, message) {
            if (requestId === fullRoot.pendingModeRequestId) {
                fullRoot.pendingModeRequestId = ""
                if (!ok) {
                    fullRoot.modeSelectionOverride = ""
                }
                fullRoot.setFeedback(
                    ok
                        ? i18n("Mode updated")
                        : i18n("Failed to update mode: %1", errorMessage),
                    ok ? "success" : "error"
                )
                return
            }

            if (requestId === fullRoot.pendingFixedRequestId) {
                fullRoot.pendingFixedRequestId = ""
                fullRoot.setFeedback(
                    ok
                        ? i18n("Fixed speed saved")
                        : i18n("Failed to save fixed speed: %1", errorMessage),
                    ok ? "success" : "error"
                )
                return
            }

            if (requestId === fullRoot.pendingTuneRequestId) {
                fullRoot.pendingTuneRequestId = ""
                fullRoot.setFeedback(
                    ok
                        ? i18n("CPU limits applied")
                        : i18n("Failed to apply CPU limits: %1", errorMessage),
                    ok ? "success" : "error"
                )
                return
            }

            if (requestId === fullRoot.pendingBoostRequestId) {
                fullRoot.pendingBoostRequestId = ""
                fullRoot.setFeedback(
                    ok
                        ? i18n("GPU boost updated")
                        : i18n("Failed to update GPU boost: %1", errorMessage),
                    ok ? "success" : "error"
                )
            }
        }
    }

    Component.onCompleted: syncDraftsFromState()

    PlasmaComponents.ScrollView {
        id: scrollView

        visible: fullRoot.connected
            && fullRoot.hasState
            && fullRoot.protocolCompatible
        anchors.fill: parent
        clip: true
        QQC2.ScrollBar.horizontal.policy: QQC2.ScrollBar.AlwaysOff

        ColumnLayout {
            width: scrollView.availableWidth
            spacing: Kirigami.Units.largeSpacing

            Item {
                Layout.fillWidth: true
                implicitHeight: statusLabel.implicitHeight

                PlasmaComponents.Label {
                    id: statusLabel

                    anchors.left: parent.left
                    anchors.right: parent.right
                    text: fullRoot.connectionSummaryText
                    color: fullRoot.connectionSummaryColor
                    font: Kirigami.Theme.smallFont
                    wrapMode: Text.WordWrap
                }
            }

            InlineStatusMessage {
                messageText: fullRoot.feedbackText
                tone: fullRoot.feedbackTone
            }

            Kirigami.InlineMessage {
                visible: fullRoot.staleActivity
                    && fullRoot.connected
                    && fullRoot.hasState
                    && fullRoot.protocolCompatible
                type: Kirigami.MessageType.Warning
                text: i18n("Telemetry last updated %1 seconds ago. ALFC reconnects automatically, but you can retry now if the values stay stale.",
                    fullRoot.staleActivitySeconds)
                Layout.fillWidth: true
                actions: Kirigami.Action {
                    icon.name: "view-refresh"
                    text: i18nc("@action:button", "Reconnect")
                    onTriggered: fullRoot.backend?.reconnect()
                }
            }

            SectionCard {
                title: i18n("Overview")
                subtitle: i18n("Temperatures and fan targets stay in sync with the web UI and other connected clients.")

                GridLayout {
                    columns: fullRoot.isPlanar ? 4 : 2
                    columnSpacing: Kirigami.Units.mediumSpacing
                    rowSpacing: Kirigami.Units.mediumSpacing
                    Layout.fillWidth: true

                    MetricTile {
                        label: i18n("CPU")
                        value: fullRoot.hasTelemetrySnapshot
                            ? i18n("%1\u00B0C", Math.round(fullRoot.safeActivity.avgCPUTemp))
                            : "--"
                        valueColor: fullRoot.hasActivity
                            ? fullRoot.tempColor(
                                Math.round(fullRoot.safeActivity.avgCPUTemp))
                            : Kirigami.Theme.disabledTextColor
                        subtitle: fullRoot.hasActivity
                            ? i18n("Average temperature")
                            : (fullRoot.staleActivity
                                ? i18n("Stale (%1s ago)", fullRoot.staleActivitySeconds)
                                : i18n("Average temperature"))
                    }

                    MetricTile {
                        label: i18n("GPU")
                        value: fullRoot.hasTelemetrySnapshot
                            ? i18n("%1\u00B0C", Math.round(fullRoot.safeActivity.avgGPUTemp))
                            : "--"
                        valueColor: fullRoot.hasActivity
                            ? fullRoot.tempColor(
                                Math.round(fullRoot.safeActivity.avgGPUTemp))
                            : Kirigami.Theme.disabledTextColor
                        subtitle: fullRoot.hasActivity
                            ? i18n("Average temperature")
                            : (fullRoot.staleActivity
                                ? i18n("Stale (%1s ago)", fullRoot.staleActivitySeconds)
                                : i18n("Average temperature"))
                    }

                    MetricTile {
                        label: i18n("Fan")
                        value: fullRoot.hasTelemetrySnapshot
                            ? (fullRoot.safeActivity.appliedSpeed != null
                                ? i18n("%1%", Math.round(fullRoot.safeActivity.appliedSpeed))
                                : i18n("Pending"))
                            : (fullRoot.fixedModeEnabled
                                ? i18n("%1%", fullRoot.safeState.fixedPercentage)
                                : "--")
                        subtitle: fullRoot.hasTelemetrySnapshot
                            ? i18n("Target %1%", Math.round(fullRoot.safeActivity.target))
                            : i18n("Current output")
                    }

                    MetricTile {
                        label: i18n("Mode")
                        value: fullRoot.hasState
                            ? (fullRoot.fanControlAvailable
                                ? (fullRoot.fixedModeEnabled
                                    ? i18n("Fixed")
                                    : i18n("Auto"))
                                : i18n("Unavailable"))
                            : "--"
                        subtitle: fullRoot.hasState
                            ? (fullRoot.fanControlAvailable
                                ? (fullRoot.fixedModeEnabled
                                    ? i18n("Stored speed %1%",
                                        fullRoot.safeState.fixedPercentage)
                                    : i18n("Curve control active"))
                                : i18n("Backend connected without fan control"))
                            : i18n("Waiting for state")
                    }
                }
            }

            SectionCard {
                title: i18n("Quick Control")
                subtitle: i18n("Switch modes quickly on the desktop or from the popup without opening the browser UI.")

                RowLayout {
                    visible: fullRoot.fanControlAvailable
                    Layout.fillWidth: true
                    spacing: 0

                    PlasmaComponents.Button {
                        text: i18n("Auto")
                        checkable: true
                        checked: fullRoot.selectedMode === "auto"
                        enabled: fullRoot.hasState
                            && fullRoot.fanControlAvailable
                            && !fullRoot.modeBusy
                        Layout.fillWidth: true
                        QQC2.ButtonGroup.group: modeButtonGroup
                        Accessible.name: i18n("Auto fan mode")
                        Accessible.description: i18n("Use the stored CPU and GPU fan curves.")
                        onClicked: fullRoot.requestMode("auto")
                    }

                    PlasmaComponents.Button {
                        text: i18n("Fixed")
                        checkable: true
                        checked: fullRoot.selectedMode === "fixed"
                        enabled: fullRoot.hasState
                            && fullRoot.fanControlAvailable
                            && !fullRoot.modeBusy
                        Layout.fillWidth: true
                        QQC2.ButtonGroup.group: modeButtonGroup
                        Accessible.name: i18n("Fixed fan mode")
                        Accessible.description: i18n("Lock the fans to a fixed output percentage.")
                        onClicked: fullRoot.requestMode("fixed")
                    }
                }

                PlasmaComponents.Label {
                    text: !fullRoot.fanControlAvailable
                        ? i18n("Fan control is not available on this system.")
                        : (fullRoot.fixedModeEnabled
                            ? i18n("Fixed mode is active. Temperatures continue to update, but the fan output stays locked.")
                            : i18n("Auto mode follows the stored CPU/GPU curves below."))
                    color: Kirigami.Theme.disabledTextColor
                    font: Kirigami.Theme.smallFont
                    wrapMode: Text.WordWrap
                    Layout.fillWidth: true
                }

                ColumnLayout {
                    visible: fullRoot.fanControlAvailable
                    Layout.fillWidth: true
                    enabled: fullRoot.hasState

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Kirigami.Units.smallSpacing

                        PlasmaComponents.Label {
                            text: i18n("Fixed speed")
                            Layout.preferredWidth: Kirigami.Units.gridUnit * 6
                        }

                        PlasmaComponents.Slider {
                            id: speedSlider

                            Layout.fillWidth: true
                            from: 0
                            to: 100
                            stepSize: 1
                            enabled: fullRoot.hasState
                                && fullRoot.fanControlAvailable
                                && !fullRoot.fixedBusy
                            Accessible.name: i18n("Fixed fan speed")
                            Accessible.description: i18n("Choose the fixed fan speed percentage.")

                            Binding on value {
                                value: fullRoot.draftFixedPercentage
                                when: !speedSlider.pressed
                                restoreMode: Binding.RestoreBinding
                            }

                            onMoved: fullRoot.draftFixedPercentage = Math.round(value)
                        }

                        PlasmaComponents.TextField {
                            id: speedField

                            Layout.preferredWidth: Kirigami.Units.gridUnit * 4
                            horizontalAlignment: Text.AlignHCenter
                            Accessible.name: i18n("Fixed fan speed percentage")
                            Accessible.description: i18n("Enter a fixed fan speed from 0 to 100 percent.")
                            validator: IntValidator {
                                bottom: 0
                                top: 100
                            }

                            Binding on text {
                                value: fullRoot.draftFixedPercentage.toString()
                                when: !speedField.activeFocus
                                restoreMode: Binding.RestoreBinding
                            }

                            onTextEdited: {
                                const value = parseInt(text, 10)
                                if (!Number.isNaN(value)) {
                                    fullRoot.draftFixedPercentage =
                                        Math.max(0, Math.min(100, value))
                                }
                            }

                            onEditingFinished: {
                                const value = parseInt(text, 10)
                                if (!Number.isNaN(value)) {
                                    fullRoot.draftFixedPercentage =
                                        Math.max(0, Math.min(100, value))
                                }
                            }
                        }

                        PlasmaComponents.Button {
                            text: fullRoot.fixedBusy
                                ? i18n("Saving…")
                                : i18n("Apply")
                            enabled: fullRoot.hasState
                                && fullRoot.fanControlAvailable
                                && !fullRoot.fixedBusy
                            Accessible.name: i18n("Apply fixed fan speed")
                            Accessible.description: i18n("Send the selected fixed fan speed to the backend.")
                            onClicked: fullRoot.pendingFixedRequestId =
                                fullRoot.backend.setFixedPercentage(
                                    fullRoot.draftFixedPercentage)
                        }
                    }
                }
            }

            SectionCard {
                visible: fullRoot.fanControlAvailable
                title: i18n("Fan Curves")
                subtitle: i18n("Edit the stored CPU and GPU fan curves. The higher target always wins because both fans share heat pipes.")

                FanTableEditor {
                    backend: fullRoot.backend
                    Layout.fillWidth: true
                    Layout.minimumHeight: Kirigami.Units.gridUnit
                        * (fullRoot.isPlanar ? 15 : 12)
                }
            }

            SectionCard {
                title: i18n("Advanced")
                subtitle: i18n("Optional platform features that depend on what the backend reports for this machine.")

                RowLayout {
                    visible: fullRoot.hasState
                        && fullRoot.safeState.isGpuBoostAvailable === true
                    Layout.fillWidth: true

                    PlasmaComponents.Label {
                        text: i18n("GPU boost")
                        Layout.fillWidth: true
                    }

                    PlasmaComponents.Switch {
                        checked: fullRoot.hasState
                            && fullRoot.safeState.gpuBoost === true
                        enabled: !fullRoot.boostBusy
                        Accessible.name: i18n("GPU boost")
                        Accessible.description: i18n("Enable or disable GPU boost on supported systems.")
                        onClicked: {
                            fullRoot.pendingBoostRequestId =
                                fullRoot.backend.setGpuBoost(checked)
                        }
                    }
                }

                PlasmaComponents.Label {
                    visible: fullRoot.hasState
                        && fullRoot.safeState.isGpuBoostAvailable === false
                    text: i18n("GPU boost is not available on this system.")
                    color: Kirigami.Theme.disabledTextColor
                    font: Kirigami.Theme.smallFont
                    wrapMode: Text.WordWrap
                    Layout.fillWidth: true
                }

                ColumnLayout {
                    visible: fullRoot.hasState
                        && fullRoot.safeState.isCpuTuningAvailable === true
                    Layout.fillWidth: true
                    spacing: Kirigami.Units.smallSpacing

                    PlasmaComponents.Label {
                        text: i18n("CPU power limits (watts)")
                        font.bold: true
                        Layout.fillWidth: true
                    }

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Kirigami.Units.smallSpacing

                        PlasmaComponents.Label {
                            text: i18n("PL1")
                            Layout.preferredWidth: Kirigami.Units.gridUnit * 3
                        }

                        PlasmaComponents.TextField {
                            id: pl1Field

                            Layout.fillWidth: true
                            Accessible.name: i18n("PL1 power limit")
                            Accessible.description: i18n("Enter the long-duration CPU power limit in watts.")
                            validator: IntValidator {
                                bottom: 0
                                top: 200
                            }

                            Binding on text {
                                value: fullRoot.draftPl1.toString()
                                when: !pl1Field.activeFocus
                                restoreMode: Binding.RestoreBinding
                            }

                            onTextEdited: {
                                const value = parseInt(text, 10)
                                if (!Number.isNaN(value)) {
                                    fullRoot.draftPl1 = Math.max(0, Math.min(200, value))
                                }
                            }

                            onEditingFinished: {
                                const value = parseInt(text, 10)
                                if (!Number.isNaN(value)) {
                                    fullRoot.draftPl1 = Math.max(0, Math.min(200, value))
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
                            Accessible.name: i18n("PL2 power limit")
                            Accessible.description: i18n("Enter the short-duration CPU power limit in watts.")
                            validator: IntValidator {
                                bottom: 0
                                top: 200
                            }

                            Binding on text {
                                value: fullRoot.draftPl2.toString()
                                when: !pl2Field.activeFocus
                                restoreMode: Binding.RestoreBinding
                            }

                            onTextEdited: {
                                const value = parseInt(text, 10)
                                if (!Number.isNaN(value)) {
                                    fullRoot.draftPl2 = Math.max(0, Math.min(200, value))
                                }
                            }

                            onEditingFinished: {
                                const value = parseInt(text, 10)
                                if (!Number.isNaN(value)) {
                                    fullRoot.draftPl2 = Math.max(0, Math.min(200, value))
                                }
                            }
                        }

                        PlasmaComponents.Button {
                            text: fullRoot.tuningBusy
                                ? i18n("Applying…")
                                : i18n("Apply")
                            enabled: !fullRoot.tuningBusy
                            Accessible.name: i18n("Apply CPU power limits")
                            Accessible.description: i18n("Send the configured PL1 and PL2 values to the backend.")
                            onClicked: fullRoot.pendingTuneRequestId =
                                fullRoot.backend.applyTune(
                                    fullRoot.draftPl1,
                                    fullRoot.draftPl2)
                        }
                    }
                }

                PlasmaComponents.Label {
                    visible: fullRoot.hasState
                        && fullRoot.safeState.isCpuTuningAvailable === false
                    text: i18n("CPU tuning is not available on this system.")
                    color: Kirigami.Theme.disabledTextColor
                    font: Kirigami.Theme.smallFont
                    wrapMode: Text.WordWrap
                    Layout.fillWidth: true
                }
            }
        }
    }

    PlasmaExtras.PlaceholderMessage {
        visible: !scrollView.visible
        anchors.centerIn: parent
        width: parent.width - Kirigami.Units.gridUnit * 2
        iconName: !fullRoot.connected
            ? "network-disconnect-symbolic"
            : (!fullRoot.hasState
                ? "view-refresh-symbolic"
                : "dialog-error-symbolic")
        text: fullRoot.backend != null && fullRoot.backend.lastError.length > 0
            ? i18n("Disconnected: %1", fullRoot.backend.lastError)
            : (!fullRoot.connected
                ? (fullRoot.connecting
                    ? i18n("Connecting to the ALFC backend")
                    : i18n("Waiting for the ALFC backend"))
                : (!fullRoot.hasState
                    ? i18n("Connected to the ALFC backend, waiting for the initial state snapshot")
                    : i18n("Unsupported backend protocol %1. This widget supports ALFC 1.x.",
                        fullRoot.protocolVersion)))
        helpfulAction: Kirigami.Action {
            icon.name: !fullRoot.connected || !fullRoot.hasState
                ? "view-refresh"
                : "configure"
            text: !fullRoot.connected || !fullRoot.hasState
                ? i18nc("@action:button", "Reconnect")
                : i18n("Configure Widget")
            onTriggered: {
                if (!fullRoot.connected || !fullRoot.hasState) {
                    fullRoot.backend?.reconnect()
                } else {
                    const action = Plasmoid.internalAction("configure")
                    if (action) {
                        action.trigger()
                    }
                }
            }
        }
    }
}
