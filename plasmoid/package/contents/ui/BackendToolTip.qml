pragma ComponentBehavior: Bound

import QtQuick

// Shared by the applet's native tooltip and its custom tooltip item. Derive
// command feedback from acknowledged telemetry, independently of newer mode
// settings broadcasts; none of these percentages are measured fan RPM.
QtObject {
    id: root

    required property var backend

    readonly property bool connected: backend != null && backend.isConnected
    readonly property bool connecting: backend != null && backend.isConnecting
    readonly property bool hasState: backend != null && backend.hasState
    readonly property bool protocolCompatible: backend == null
        || backend.protocolCompatible !== false
    readonly property string protocolVersion: backend?.protocolVersion ?? ""
    readonly property string lastError: backend?.lastError ?? ""
    readonly property string lastRequestError: backend?.lastRequestError ?? ""
    readonly property var state: hasState ? backend.latestState : null
    readonly property bool restartRequired: state != null && state.restartRequired === true
    readonly property bool fanControlAvailable: state == null
        || state.isFanControlAvailable !== false
    readonly property bool telemetryUnavailable: backend != null && backend.initialActivityTimedOut
    readonly property var telemetryActivity: backend != null && backend.hasActivity
        ? backend.latestActivity : null
    readonly property bool sensorFailure: telemetryActivity != null
        && telemetryActivity.sensorFailure === true
    readonly property int telemetryAgeSeconds: telemetryActivity != null
        ? Math.ceil(backend.activityAgeMs / 1000) : 0
    readonly property bool hasFreshActivity: backend != null && backend.hasFreshActivity
    readonly property var activity: hasFreshActivity ? backend.latestActivity : null

    readonly property string text: {
        if (root.connecting) {
            return i18n("Connecting")
        }

        if (!root.connected) {
            return root.lastError.length > 0
                ? i18n("Disconnected: %1", root.lastError)
                : i18n("Disconnected")
        }

        if (!root.protocolCompatible) {
            return i18n("Unsupported backend protocol %1",
                root.protocolVersion)
        }

        if (!root.hasState) {
            return root.lastError.length > 0
                ? root.lastError : i18n("Connected, waiting for state")
        }

        if (root.restartRequired) {
            return i18n("A native service stopped responding. Restart ALFC to restore unavailable features.")
        }

        if (root.sensorFailure) {
            if (root.telemetryActivity.appliedSpeed === null) {
                return i18n("Sensor error — fan output unconfirmed")
            }
            return i18n("Sensor error — last acknowledged fan command %1%",
                Math.round(root.telemetryActivity.appliedSpeed))
        }

        if (root.lastRequestError.length > 0) {
            return i18n("Last action failed: %1", root.lastRequestError)
        }

        if (!root.fanControlAvailable) {
            return i18n("Fan control unavailable")
        }

        if (root.telemetryUnavailable) {
            return i18n("Telemetry unavailable")
        }

        if (!root.hasFreshActivity) {
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
}
