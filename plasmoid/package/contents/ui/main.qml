pragma ComponentBehavior: Bound

import QtQuick

import org.kde.kirigami as Kirigami
import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.plasmoid

PlasmoidItem {
    id: root

    WidgetSettings {
        id: widgetSettings
    }

    readonly property bool isPlanar: Plasmoid.formFactor === PlasmaCore.Types.Planar
    readonly property bool inTray: Boolean(
        Plasmoid.containmentDisplayHints
        & PlasmaCore.Types.ContainmentForcesSquarePlasmoids
    )
    readonly property bool iconOnlyCompact: !root.isPlanar
        && (root.inTray || widgetSettings.compactShowIcon)
    readonly property string webUiUrl: widgetSettings.webUiUrl
    readonly property int warningTemp: widgetSettings.warningTemp
    readonly property bool hasState: backendConnection.hasState
    readonly property bool protocolCompatible: backendConnection.protocolCompatible
    readonly property string protocolVersion: backendConnection.protocolVersion
    readonly property bool hasActivity: backendConnection.hasFreshActivity
    readonly property bool hasTelemetrySnapshot: backendConnection.hasActivity
    readonly property int telemetryAgeSeconds: hasTelemetrySnapshot
        ? Math.ceil(backendConnection.activityAgeMs / 1000)
        : 0
    readonly property var backendState: hasState ? backendConnection.latestState : null
    readonly property var activity: hasActivity ? backendConnection.latestActivity : null
    readonly property var telemetryActivity: hasTelemetrySnapshot
        ? backendConnection.latestActivity
        : null
    readonly property bool fanControlAvailable: backendState == null
        || backendState.isFanControlAvailable !== false
    readonly property bool isFixedMode: backendState != null
        && backendState.doFixedSpeed === true
    readonly property bool isOverheating: telemetryActivity != null
        && (Math.round(telemetryActivity.avgCPUTemp) >= warningTemp
            || Math.round(telemetryActivity.avgGPUTemp) >= warningTemp)

    Plasmoid.title: i18n("Aorus Laptop Fan Control")
    Plasmoid.backgroundHints: PlasmaCore.Types.DefaultBackground
        | PlasmaCore.Types.ConfigurableBackground
    activationTogglesExpanded: true

    switchWidth: root.isPlanar ? -1 : Kirigami.Units.iconSizes.enormous
    switchHeight: root.isPlanar ? -1 : Kirigami.Units.iconSizes.enormous

    Plasmoid.status: {
        if (root.hasState && !root.protocolCompatible) {
            return PlasmaCore.Types.RequiresAttentionStatus
        }

        if (root.isOverheating) {
            return PlasmaCore.Types.RequiresAttentionStatus
        }

        if (backendConnection.isConnected) {
            return PlasmaCore.Types.ActiveStatus
        }

        return PlasmaCore.Types.PassiveStatus
    }
    Plasmoid.icon: {
        if (root.hasState && !root.protocolCompatible) {
            return "dialog-error-symbolic"
        }

        if (!backendConnection.isConnected) {
            return "network-disconnect-symbolic"
        }

        if (root.isOverheating) {
            return "dialog-warning-symbolic"
        }

        return "computer-laptop"
    }

    preferredRepresentation: root.isPlanar ? fullRepresentation : null

    toolTipMainText: Plasmoid.title
    toolTipSubText: {
        if (backendConnection.isConnecting) {
            return i18n("Connecting")
        }

        if (!backendConnection.isConnected) {
            return backendConnection.lastError.length > 0
                ? i18n("Disconnected: %1", backendConnection.lastError)
                : i18n("Disconnected")
        }

        if (!backendConnection.hasState) {
            return i18n("Connected, waiting for state")
        }

        if (!root.protocolCompatible) {
            return i18n("Unsupported backend protocol %1",
                root.protocolVersion)
        }

        if (!backendConnection.hasFreshActivity) {
            if (root.telemetryActivity != null) {
                const staleFanText = telemetryActivity.appliedSpeed != null
                    ? i18n("%1%", Math.round(telemetryActivity.appliedSpeed))
                    : "--"

                return i18n("Last update %1s ago: CPU %2\u00B0C | GPU %3\u00B0C | Fan %4",
                    root.telemetryAgeSeconds,
                    Math.round(telemetryActivity.avgCPUTemp),
                    Math.round(telemetryActivity.avgGPUTemp),
                    staleFanText)
            }

            return i18n("Connected, waiting for telemetry")
        }

        if (activity == null) {
            return i18n("Connected, waiting for telemetry")
        }

        const fanText = activity.appliedSpeed != null
            ? i18n("%1%", Math.round(activity.appliedSpeed))
            : "--"

        return i18n("CPU: %1\u00B0C | GPU: %2\u00B0C | Fan: %3",
            Math.round(activity.avgCPUTemp),
            Math.round(activity.avgGPUTemp),
            fanText)
    }

    BackendConnection {
        id: backendConnection

        serverUrl: widgetSettings.serverUrl
    }

    function openWebUi() {
        if (root.webUiUrl.length === 0) {
            return
        }

        Qt.openUrlExternally(root.webUiUrl)
    }

    function toggleFanMode() {
        if (!root.hasState || !root.protocolCompatible
                || !root.fanControlAvailable) {
            return
        }

        backendConnection.setFixedMode(!root.isFixedMode)
    }

    function openConfiguration() {
        const action = Plasmoid.internalAction("configure")
        if (action) {
            action.trigger()
        }
    }

    function reconnectBackend() {
        backendConnection.reconnect()
    }

    compactRepresentation: CompactRepresentation {
        backend: backendConnection
        plasmoidItem: root
        iconOnly: root.iconOnlyCompact
        warningTemp: root.warningTemp
    }

    fullRepresentation: FullRepresentation {
        backend: backendConnection
        webUiUrl: root.webUiUrl
        isPlanar: root.isPlanar
        warningTemp: root.warningTemp
    }

    Plasmoid.contextualActions: [
        PlasmaCore.Action {
            text: root.isFixedMode
                ? i18nc("@action", "Switch to Auto Mode")
                : i18nc("@action", "Switch to Fixed Mode")
            icon.name: "view-refresh"
            enabled: root.hasState
                && root.protocolCompatible
                && root.fanControlAvailable
            onTriggered: root.toggleFanMode()
        },
        PlasmaCore.Action {
            text: i18nc("@action", "Reconnect Backend")
            icon.name: "view-refresh"
            onTriggered: root.reconnectBackend()
        },
        PlasmaCore.Action {
            text: i18nc("@action", "Open Web UI")
            icon.name: "internet-web-browser"
            enabled: root.webUiUrl.length > 0
            onTriggered: root.openWebUi()
        },
        PlasmaCore.Action {
            text: i18nc("@action", "Configure Widget")
            icon.name: "configure"
            onTriggered: root.openConfiguration()
        }
    ]
}
