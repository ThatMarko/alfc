import QtQuick
import org.kde.plasma.plasmoid
import org.kde.plasma.core as PlasmaCore
import org.kde.kirigami as Kirigami

PlasmoidItem {
    id: root

    // ── Context Detection ──────────────────────────────────────────
    // Bitflag check: most reliable Plasma 6 tray detection (from apdatifier pattern)
    readonly property bool inTray: (plasmoid.containmentDisplayHints & PlasmaCore.Types.ContainmentDrawsPlasmoidHeading)
    readonly property bool onDesktop: Plasmoid.location === PlasmaCore.Types.Floating
    readonly property bool inPanel: !inTray && !onDesktop

    // ── Derived Web UI URL ─────────────────────────────────────────
    // Derives HTTP URL from the configured WebSocket URL
    // e.g. "ws://localhost:5522/ws" → "http://localhost:5522"
    readonly property string webUiUrl: {
        var wsUrl = Plasmoid.configuration.serverUrl || "ws://localhost:5522/ws"
        // Strip the /ws path suffix
        var base = wsUrl.replace(/\/ws\/?$/, "")
        // Replace protocol: wss:// → https://, ws:// → http://
        return base.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://")
    }

    // ── Temperature Threshold for Attention ────────────────────────
    readonly property int warningTemp: 90
    readonly property bool hasData: backendConnection.isConnected
        && backendConnection.latestActivity != null
        && backendConnection.latestActivity.avgCPUTemp !== undefined
    readonly property int cpuTemp: hasData ? Math.round(backendConnection.latestActivity.avgCPUTemp) : 0
    readonly property int gpuTemp: hasData ? Math.round(backendConnection.latestActivity.avgGPUTemp) : 0
    readonly property bool isOverheating: hasData && (cpuTemp >= warningTemp || gpuTemp >= warningTemp)

    // ── Smart Plasmoid.status ──────────────────────────────────────
    // Controls visibility in system tray:
    //   ActiveStatus             = always shown in tray
    //   PassiveStatus            = hidden in tray (in "hidden items" popup)
    //   RequiresAttentionStatus  = shown + blinks/pulses
    Plasmoid.status: {
        if (isOverheating)
            return PlasmaCore.Types.RequiresAttentionStatus
        if (backendConnection.isConnected)
            return PlasmaCore.Types.ActiveStatus
        return PlasmaCore.Types.PassiveStatus
    }

    // ── Icon (changes based on state) ──────────────────────────────
    Plasmoid.icon: {
        if (!backendConnection.isConnected)
            return "network-disconnect"
        if (isOverheating)
            return "dialog-warning"
        return "computer-laptop"
    }

    // ── Desktop Widget Background ──────────────────────────────────
    // Allow configurable background when on desktop (standard, shadow-only, translucent, etc.)
    Plasmoid.backgroundHints: PlasmaCore.Types.DefaultBackground | PlasmaCore.Types.ConfigurableBackground

    // ── Representation Selection ───────────────────────────────────
    // Desktop: show full view directly (no compact needed)
    // Panel/Tray: show compact, click to expand
    preferredRepresentation: onDesktop ? fullRepresentation : compactRepresentation

    switchWidth: Kirigami.Units.gridUnit * 20
    switchHeight: Kirigami.Units.gridUnit * 20

    // ── Tooltip ────────────────────────────────────────────────────
    // toolTipMainText is still used by accessibility (screen readers)
    // toolTipItem overrides the visual tooltip with a mini dashboard
    toolTipMainText: i18n("Aorus Laptop Fan Control")
    toolTipSubText: {
        if (!backendConnection.isConnected)
            return i18n("Disconnected")
        if (!hasData)
            return i18n("Connected — waiting for data")
        var fan = backendConnection.latestActivity.appliedSpeed
        return i18n("CPU: %1°C | GPU: %2°C | Fan: %3%",
            cpuTemp, gpuTemp, fan != null ? Math.round(fan) : "--")
    }

    // Rich tooltip: mini dashboard on hover
    toolTipItem: ToolTipView {
        backend: backendConnection
    }

    // ── Right-Click Context Menu ───────────────────────────────────
    // Quick actions accessible without opening the full popup
    Plasmoid.contextualActions: [
        PlasmaCore.Action {
            text: backendConnection.latestState != null && backendConnection.latestState.doFixedSpeed === true
                ? i18n("Switch to Auto Mode")
                : i18n("Switch to Fixed Mode")
            icon.name: "system-switch-user"
            enabled: backendConnection.isConnected && backendConnection.latestState != null
            onTriggered: {
                var newMode = !(backendConnection.latestState && backendConnection.latestState.doFixedSpeed === true)
                backendConnection.send({
                    kind: "dofixedspeed",
                    methodId: "ctx-toggle-mode",
                    methodName: "setMode",
                    data: newMode
                })
            }
        },
        PlasmaCore.Action {
            text: i18n("Open Web UI")
            icon.name: "internet-web-browser"
            onTriggered: Qt.openUrlExternally(root.webUiUrl)
        }
    ]

    // ── Backend & Representations ──────────────────────────────────
    property alias backend: backendConnection

    BackendConnection {
        id: backendConnection
    }

    compactRepresentation: CompactRepresentation {
        backend: backendConnection
        inTray: root.inTray
    }

    fullRepresentation: FullRepresentation {
        backend: backendConnection
        webUiUrl: root.webUiUrl
    }
}
