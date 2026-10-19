pragma ComponentBehavior: Bound

import QtQuick
import "Protocol.js" as Protocol
import "TextFormatting.js" as TextFormatting
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
    readonly property bool telemetryUnavailable: backend != null
        && backend.initialActivityTimedOut
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

        if (!protocolCompatible) {
            return i18n("Unsupported backend protocol %1",
                protocolVersion)
        }

        if (!hasState) {
            return i18n("Connected, waiting for state")
        }

        if (sensorFailure) {
            return i18n("Sensor error")
        }

        if (!fanControlAvailable) {
            return i18n("Fan control unavailable")
        }

        if (hasActivity) {
            return i18n("Live telemetry")
        }

        if (staleActivity) {
            return i18n("Telemetry stale")
        }

        if (telemetryUnavailable) {
            return i18n("Telemetry unavailable")
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
    // sensorFailure is absent on protocol 1.0 servers — treated as false
    readonly property bool sensorFailure: hasTelemetrySnapshot
        && safeActivity.sensorFailure === true
    readonly property bool restartRequired: hasState && safeState.restartRequired === true
    readonly property bool fixedModeEnabled: hasState
        && safeState.doFixedSpeed === true
    readonly property bool fanControlAvailable: hasState
        ? safeState.isFanControlAvailable !== false
        : true
    readonly property bool modeBusy: pendingModeRequestId.length > 0
        || (backend != null && backend.modeRequestPending)
    readonly property bool fixedBusy: pendingFixedRequestId.length > 0
    readonly property bool boostBusy: pendingBoostRequestId.length > 0
    readonly property bool tuningBusy: pendingTuneRequestId.length > 0
    readonly property bool canSyncFixedDraft: !speedSlider.pressed
        && !speedField.activeFocus
        && !fixedBusy && !fixedDraftDirty
    readonly property bool canSyncPl1Draft: !pl1Field.activeFocus
        && !tuningBusy && !pl1DraftDirty
    readonly property bool canSyncPl2Draft: !pl2Field.activeFocus
        && !tuningBusy && !pl2DraftDirty
    readonly property bool fixedDraftValid: /^\d+$/.test(draftFixedPercentage)
        && Protocol.isIntegerInRange(Number(draftFixedPercentage), 0, 100)
    readonly property bool tuneDraftValid: /^\d+$/.test(draftPl1)
        && /^\d+$/.test(draftPl2)
        && Protocol.isIntegerInRange(Number(draftPl1), 0, 200)
        && Protocol.isIntegerInRange(Number(draftPl2), 0, 200)
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

        if (sensorFailure) {
            return Kirigami.Theme.negativeTextColor
        }

        if (!fanControlAvailable) {
            return Kirigami.Theme.neutralTextColor
        }

        if (hasActivity) {
            return Kirigami.Theme.positiveTextColor
        }

        if (staleActivity || telemetryUnavailable) {
            return Kirigami.Theme.neutralTextColor
        }

        return Kirigami.Theme.disabledTextColor
    }

    readonly property bool isWide: fullRoot.width >= Kirigami.Units.gridUnit * 36
        || (isPlanar && fullRoot.width >= Kirigami.Units.gridUnit * 30)

    property string draftFixedPercentage: "50"
    property string draftPl1: "37"
    property string draftPl2: "106"
    property bool fixedDraftDirty: false
    property bool pl1DraftDirty: false
    property bool pl2DraftDirty: false
    property string draftSourceUrl: ""
    property int authoritativeFixedPercentage: -1
    property int authoritativePl1: -1
    property int authoritativePl2: -1
    property string pendingModeRequestId: ""
    property string pendingFixedRequestId: ""
    property string pendingBoostRequestId: ""
    property string pendingTuneRequestId: ""
    property string modeSelectionOverride: ""
    property string feedbackText: ""
    property string feedbackTone: ""

    collapseMarginsHint: true
    Layout.minimumWidth: Kirigami.Units.gridUnit * (isPlanar ? 24 : 22)
    Layout.minimumHeight: Kirigami.Units.gridUnit * (isPlanar ? 24 : 22)
    Layout.preferredWidth: Kirigami.Units.gridUnit * (isPlanar ? 44 : 26)
    Layout.preferredHeight: Kirigami.Units.gridUnit * (isPlanar ? 30 : 32)

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

        const sourceUrl = String(fullRoot.backend.url ?? "")
        const sourceChanged = sourceUrl !== fullRoot.draftSourceUrl
        const fixedChanged = fullRoot.authoritativeFixedPercentage >= 0
            && fullRoot.authoritativeFixedPercentage !== fullRoot.safeState.fixedPercentage
        const pl1Changed = fullRoot.authoritativePl1 >= 0
            && fullRoot.authoritativePl1 !== fullRoot.safeState.pl1
        const pl2Changed = fullRoot.authoritativePl2 >= 0
            && fullRoot.authoritativePl2 !== fullRoot.safeState.pl2
        if (sourceChanged) {
            fullRoot.draftSourceUrl = sourceUrl
            fullRoot.fixedDraftDirty = false
            fullRoot.pl1DraftDirty = false
            fullRoot.pl2DraftDirty = false
            fullRoot.feedbackText = ""
            fullRoot.feedbackTone = ""
            feedbackTimer.stop()
        }
        fullRoot.syncModeSelection()

        if (fixedChanged) fullRoot.fixedDraftDirty = false
        if (pl1Changed) fullRoot.pl1DraftDirty = false
        if (pl2Changed) fullRoot.pl2DraftDirty = false

        if ((sourceChanged || fixedChanged || fullRoot.canSyncFixedDraft) && typeof fullRoot.safeState.fixedPercentage === "number") {
            fullRoot.draftFixedPercentage = String(fullRoot.safeState.fixedPercentage)
            if (sourceChanged || fixedChanged) speedField.text = fullRoot.draftFixedPercentage
        }

        if ((sourceChanged || pl1Changed || fullRoot.canSyncPl1Draft) && typeof fullRoot.safeState.pl1 === "number") {
            fullRoot.draftPl1 = String(fullRoot.safeState.pl1)
            if (sourceChanged || pl1Changed) pl1Field.text = fullRoot.draftPl1
        }

        if ((sourceChanged || pl2Changed || fullRoot.canSyncPl2Draft) && typeof fullRoot.safeState.pl2 === "number") {
            fullRoot.draftPl2 = String(fullRoot.safeState.pl2)
            if (sourceChanged || pl2Changed) pl2Field.text = fullRoot.draftPl2
        }
        fullRoot.authoritativeFixedPercentage = fullRoot.safeState.fixedPercentage
        fullRoot.authoritativePl1 = fullRoot.safeState.pl1
        fullRoot.authoritativePl2 = fullRoot.safeState.pl2
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
        if (!fullRoot.connected || !fullRoot.hasState || !fullRoot.protocolCompatible
                || !fullRoot.fanControlAvailable || fullRoot.modeBusy) {
            return
        }

        fullRoot.modeSelectionOverride = mode
        fullRoot.pendingModeRequestId =
            fullRoot.backend.setFixedMode(mode === "fixed")
    }

    function requestFixedPercentage() {
        if (!fullRoot.connected || !fullRoot.hasState || !fullRoot.protocolCompatible
                || !fullRoot.fanControlAvailable || fullRoot.fixedBusy
                || !fullRoot.fixedDraftValid) {
            return
        }
        fullRoot.pendingFixedRequestId = fullRoot.backend.setFixedPercentage(
            Number(fullRoot.draftFixedPercentage))
    }

    function requestTune() {
        if (!fullRoot.connected || !fullRoot.hasState || !fullRoot.protocolCompatible
                || fullRoot.safeState.isCpuTuningAvailable !== true
                || fullRoot.tuningBusy || !fullRoot.tuneDraftValid) {
            return
        }
        fullRoot.pendingTuneRequestId = fullRoot.backend.applyTune(
            Number(fullRoot.draftPl1), Number(fullRoot.draftPl2))
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
                fullRoot.modeSelectionOverride = ""
                fullRoot.syncDraftsFromState()
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
                if (ok) {
                    fullRoot.fixedDraftDirty = false
                    fullRoot.draftFixedPercentage = String(fullRoot.safeState.fixedPercentage)
                }
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
                if (ok) {
                    fullRoot.pl1DraftDirty = false
                    fullRoot.pl2DraftDirty = false
                    fullRoot.draftPl1 = String(fullRoot.safeState.pl1)
                    fullRoot.draftPl2 = String(fullRoot.safeState.pl2)
                }
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
                return
            }
            // Also surface requests from the panel's quick action/menu.
            if (!ok) {
                fullRoot.setFeedback(errorMessage, "error")
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

        GridLayout {
            id: contentGrid

            width: scrollView.availableWidth
            columns: fullRoot.isWide ? 2 : 1
            columnSpacing: Kirigami.Units.largeSpacing
            rowSpacing: Kirigami.Units.largeSpacing

            Item {
                Layout.column: 0
                Layout.row: 0
                Layout.columnSpan: fullRoot.isWide ? 2 : 1
                Layout.fillWidth: true
                implicitHeight: statusSummary.implicitHeight

                ColumnLayout {
                    id: statusSummary
                    anchors.left: parent.left
                    anchors.right: parent.right

                    PlasmaComponents.Label {
                        text: fullRoot.connectionSummaryText
                        color: fullRoot.connectionSummaryColor
                        font: Kirigami.Theme.smallFont
                        wrapMode: Text.WordWrap
                        Layout.fillWidth: true
                    }

                    Kirigami.InlineMessage {
                        visible: fullRoot.restartRequired
                        type: Kirigami.MessageType.Warning
                        text: i18n("A native service stopped responding. Restart ALFC to restore unavailable features.")
                        Layout.fillWidth: true
                    }
                }
            }

            InlineStatusMessage {
                Layout.column: 0
                Layout.row: 1
                Layout.columnSpan: fullRoot.isWide ? 2 : 1
                messageText: fullRoot.feedbackText.length > 0
                    ? fullRoot.feedbackText : (fullRoot.backend?.lastRequestError ?? "")
                tone: fullRoot.feedbackText.length > 0 ? fullRoot.feedbackTone : "error"
            }

            Kirigami.InlineMessage {
                Layout.column: 0
                Layout.row: 2
                Layout.columnSpan: fullRoot.isWide ? 2 : 1
                visible: (fullRoot.staleActivity || fullRoot.telemetryUnavailable)
                    && fullRoot.connected
                    && fullRoot.hasState
                    && fullRoot.protocolCompatible
                type: Kirigami.MessageType.Warning
                text: fullRoot.telemetryUnavailable
                    ? i18n("Fan telemetry is unavailable. Reconnect if telemetry remains unavailable.")
                    : i18n("Telemetry last updated %1 seconds ago. Reconnect if the values stay stale.",
                        fullRoot.staleActivitySeconds)
                Layout.fillWidth: true
                actions: Kirigami.Action {
                    icon.name: "view-refresh"
                    text: i18nc("@action:button", "Reconnect")
                    onTriggered: fullRoot.backend?.reconnect()
                }
            }

            SectionCard {
                id: overviewCard
                Layout.column: 0
                Layout.row: 3
                Layout.fillWidth: true
                Layout.preferredWidth: fullRoot.isWide ? Kirigami.Units.gridUnit * 18 : -1

                title: i18n("Overview")
                subtitle: i18n("Temperatures and fan targets stay in sync with the web UI and other connected clients.")

                GridLayout {
                    columns: overviewCard.width >= Kirigami.Units.gridUnit * 28 ? 4 : 2
                    columnSpacing: Kirigami.Units.mediumSpacing
                    rowSpacing: Kirigami.Units.mediumSpacing
                    Layout.fillWidth: true

                    MetricTile {
                        label: i18n("CPU")
                        value: fullRoot.hasTelemetrySnapshot
                            ? (fullRoot.sensorFailure
                                ? i18n("Sensor error")
                                : i18n("%1\u00B0C", Math.round(fullRoot.safeActivity.avgCPUTemp)))
                            : "--"
                        valueColor: fullRoot.sensorFailure
                            ? Kirigami.Theme.negativeTextColor
                            : fullRoot.hasActivity
                                ? fullRoot.tempColor(
                                    Math.round(fullRoot.safeActivity.avgCPUTemp))
                                : Kirigami.Theme.disabledTextColor
                        subtitle: fullRoot.hasActivity
                            ? i18n("Average temperature")
                            : (fullRoot.staleActivity
                                ? i18n("Stale (%1s ago)", fullRoot.staleActivitySeconds)
                                : (fullRoot.telemetryUnavailable
                                    ? i18n("Telemetry unavailable")
                                    : i18n("Average temperature")))
                    }

                    MetricTile {
                        label: i18n("GPU")
                        value: fullRoot.hasTelemetrySnapshot
                            ? (fullRoot.sensorFailure
                                ? i18n("Sensor error")
                                : i18n("%1\u00B0C", Math.round(fullRoot.safeActivity.avgGPUTemp)))
                            : "--"
                        valueColor: fullRoot.sensorFailure
                            ? Kirigami.Theme.negativeTextColor
                            : fullRoot.hasActivity
                                ? fullRoot.tempColor(
                                    Math.round(fullRoot.safeActivity.avgGPUTemp))
                                : Kirigami.Theme.disabledTextColor
                        subtitle: fullRoot.hasActivity
                            ? i18n("Average temperature")
                            : (fullRoot.staleActivity
                                ? i18n("Stale (%1s ago)", fullRoot.staleActivitySeconds)
                                : (fullRoot.telemetryUnavailable
                                    ? i18n("Telemetry unavailable")
                                    : i18n("Average temperature")))
                    }

                    MetricTile {
                        label: i18n("Fan")
                        value: fullRoot.hasTelemetrySnapshot
                            ? (fullRoot.safeActivity.appliedSpeed != null
                                ? i18n("%1%", Math.round(fullRoot.safeActivity.appliedSpeed))
                                : i18n("Unconfirmed"))
                            : "--"
                        valueColor: fullRoot.hasActivity
                            ? Kirigami.Theme.textColor : Kirigami.Theme.disabledTextColor
                        subtitle: fullRoot.hasTelemetrySnapshot
                            ? i18n("Target %1%", Math.round(fullRoot.safeActivity.target))
                            : (fullRoot.telemetryUnavailable
                                ? i18n("Telemetry unavailable")
                                : i18n("Waiting for fan telemetry"))
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
                id: quickControlCard
                Layout.column: 0
                Layout.row: 4
                Layout.fillWidth: true
                Layout.preferredWidth: fullRoot.isWide ? Kirigami.Units.gridUnit * 18 : -1

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
                    enabled: fullRoot.hasState && !fullRoot.fixedBusy
                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Kirigami.Units.smallSpacing

                        PlasmaComponents.Label {
                            text: fullRoot.fixedModeEnabled
                                ? i18n("Fixed speed")
                                : i18n("Fixed preset")
                            Layout.fillWidth: true
                            wrapMode: Text.WordWrap
                        }

                        PlasmaComponents.TextField {
                            id: speedField
                            objectName: "fixedPercentageField"

                            Layout.preferredWidth: Kirigami.Units.gridUnit * 4
                            horizontalAlignment: Text.AlignHCenter
                            Accessible.name: i18n("Fixed fan speed percentage")
                            Accessible.description: i18n("Enter a fixed fan speed from 0 to 100 percent.")
                            validator: IntValidator {
                                bottom: 0
                                top: 100
                                locale: "C"
                            }
                            inputMethodHints: Qt.ImhDigitsOnly

                            Binding on text {
                                value: fullRoot.draftFixedPercentage.toString()
                                when: !speedField.activeFocus
                                restoreMode: Binding.RestoreBinding
                            }

                            onTextEdited: {
                                fullRoot.fixedDraftDirty = true
                                fullRoot.draftFixedPercentage = text
                            }
                            onActiveFocusChanged: if (!activeFocus) fullRoot.syncDraftsFromState()
                            onAccepted: fullRoot.requestFixedPercentage()
                        }

                        PlasmaComponents.Button {
                            text: fullRoot.fixedBusy
                                ? i18n("Saving…")
                                : i18n("Apply")
                            enabled: fullRoot.hasState && fullRoot.fixedDraftValid
                                && !fullRoot.fixedBusy
                            Accessible.name: i18n("Apply fixed fan speed")
                            Accessible.description: i18n("Send the selected fixed fan speed to the backend.")
                            onClicked: fullRoot.requestFixedPercentage()
                        }
                    }

                    PlasmaComponents.Slider {
                        id: speedSlider

                        Layout.fillWidth: true
                        from: 0
                        to: 100
                        stepSize: 1
                        enabled: fullRoot.hasState
                            && !fullRoot.fixedBusy
                        Accessible.name: i18n("Fixed fan speed")
                        Accessible.description: i18n("Choose the fixed fan speed percentage.")

                        Binding on value {
                            value: fullRoot.fixedDraftValid
                                ? Number(fullRoot.draftFixedPercentage) : 0
                            when: !speedSlider.pressed
                            restoreMode: Binding.RestoreBinding
                        }

                        onMoved: {
                            fullRoot.fixedDraftDirty = true
                            fullRoot.draftFixedPercentage = String(Math.round(value))
                        }
                    }
                }
            }

            SectionCard {
                id: fanCurvesCard
                visible: fullRoot.fanControlAvailable
                Layout.column: fullRoot.isWide ? 1 : 0
                Layout.row: fullRoot.isWide ? 3 : 5
                Layout.rowSpan: fullRoot.isWide ? 3 : 1
                Layout.fillWidth: true
                Layout.fillHeight: fullRoot.isWide
                Layout.preferredWidth: fullRoot.isWide ? Kirigami.Units.gridUnit * 22 : -1

                title: i18n("Fan Curves")
                subtitle: fullRoot.fixedModeEnabled
                    ? i18n("Stored CPU and GPU curves (Bypassed while Fixed Mode is active).")
                    : i18n("Edit the stored CPU and GPU fan curves. The higher target always wins because both fans share heat pipes.")

                FanTableEditor {
                    backend: fullRoot.backend
                    Layout.fillWidth: true
                    Layout.fillHeight: fullRoot.isWide
                    Layout.minimumHeight: Kirigami.Units.gridUnit
                        * (fullRoot.isPlanar ? 16 : 12)
                }
            }

            SectionCard {
                id: advancedCard
                Layout.column: 0
                Layout.row: fullRoot.isWide ? 5 : 6
                Layout.fillWidth: true
                Layout.preferredWidth: fullRoot.isWide ? Kirigami.Units.gridUnit * 18 : -1

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
                        objectName: "gpuBoostSwitch"
                        Binding on checked {
                            value: fullRoot.hasState && fullRoot.safeState.gpuBoost === true
                            when: !fullRoot.boostBusy
                            restoreMode: Binding.RestoreBindingOrValue
                        }
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
                    enabled: !fullRoot.tuningBusy
                    Layout.fillWidth: true
                    spacing: Kirigami.Units.smallSpacing

                    PlasmaComponents.Label {
                        text: i18n("CPU power limits (watts)")
                        font.bold: true
                        Layout.fillWidth: true
                    }

                    GridLayout {
                        columns: 2
                        Layout.fillWidth: true
                        columnSpacing: Kirigami.Units.smallSpacing
                        rowSpacing: Kirigami.Units.smallSpacing

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
                                locale: "C"
                            }
                            inputMethodHints: Qt.ImhDigitsOnly

                            Binding on text {
                                value: fullRoot.draftPl1.toString()
                                when: !pl1Field.activeFocus
                                restoreMode: Binding.RestoreBinding
                            }

                            onTextEdited: {
                                fullRoot.pl1DraftDirty = true
                                fullRoot.draftPl1 = text
                            }
                            onActiveFocusChanged: if (!activeFocus) fullRoot.syncDraftsFromState()
                            onAccepted: fullRoot.requestTune()
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
                                locale: "C"
                            }
                            inputMethodHints: Qt.ImhDigitsOnly

                            Binding on text {
                                value: fullRoot.draftPl2.toString()
                                when: !pl2Field.activeFocus
                                restoreMode: Binding.RestoreBinding
                            }

                            onTextEdited: {
                                fullRoot.pl2DraftDirty = true
                                fullRoot.draftPl2 = text
                            }
                            onActiveFocusChanged: if (!activeFocus) fullRoot.syncDraftsFromState()
                            onAccepted: fullRoot.requestTune()
                        }

                        PlasmaComponents.Button {
                            Layout.columnSpan: 2
                            Layout.fillWidth: true
                            text: fullRoot.tuningBusy
                                ? i18n("Applying…")
                                : i18n("Apply")
                            enabled: !fullRoot.tuningBusy && fullRoot.tuneDraftValid
                            Accessible.name: i18n("Apply CPU power limits")
                            Accessible.description: i18n("Send the configured PL1 and PL2 values to the backend.")
                            onClicked: fullRoot.requestTune()
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
            : (!fullRoot.protocolCompatible ? "dialog-error-symbolic" : !fullRoot.hasState
                ? "view-refresh-symbolic"
                : "dialog-error-symbolic")
        text: TextFormatting.literalText(fullRoot.backend != null && fullRoot.backend.lastError.length > 0
            ? (fullRoot.connected
                ? fullRoot.backend.lastError
                : i18n("Disconnected: %1", fullRoot.backend.lastError))
            : (!fullRoot.connected
                ? (fullRoot.connecting
                    ? i18n("Connecting to the ALFC backend")
                    : i18n("Waiting for the ALFC backend"))
                : (!fullRoot.hasState
                    ? i18n("Connected to the ALFC backend, waiting for the initial state snapshot")
                    : i18n("Unsupported backend protocol %1. This widget requires ALFC 1.1 or a newer 1.x version.",
                        fullRoot.protocolVersion))))
        helpfulAction: Kirigami.Action {
            icon.name: !fullRoot.connected || (fullRoot.protocolCompatible && !fullRoot.hasState)
                ? "view-refresh"
                : "configure"
            text: !fullRoot.connected || (fullRoot.protocolCompatible && !fullRoot.hasState)
                ? i18nc("@action:button", "Reconnect")
                : i18n("Configure Widget")
            onTriggered: {
                if (!fullRoot.connected || (fullRoot.protocolCompatible && !fullRoot.hasState)) {
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
