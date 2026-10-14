pragma ComponentBehavior: Bound

import QtQuick
import "WidgetUrls.js" as WidgetUrls
import org.kde.plasma.plasmoid

QtObject {
    id: root

    readonly property string defaultServerUrl: "ws://localhost:5522/ws"
    readonly property string configuredServerUrl: String(Plasmoid.configuration.serverUrl ?? "").trim()
    readonly property string configuredWebUiUrl: String(Plasmoid.configuration.webUiUrl ?? "").trim()
    readonly property string serverUrl: root.normalizeServerUrl(root.configuredServerUrl)
    readonly property string webUiUrl: root.deriveWebUiUrl(
        root.serverUrl,
        root.configuredWebUiUrl)
    readonly property int warningTemp: Plasmoid.configuration.warningTemp ?? 90
    readonly property bool compactShowIcon: Boolean(Plasmoid.configuration.compactShowIcon)

    function normalizeServerUrl(value) {
        const trimmed = String(value ?? "").trim()
        return trimmed.length > 0 ? trimmed : root.defaultServerUrl
    }

    function isValidWebSocketUrl(value) {
        return WidgetUrls.isValidWebSocketUrl(value)
    }

    function isValidHttpUrl(value) {
        return WidgetUrls.isValidHttpUrl(value)
    }

    function deriveWebUiUrl(serverUrlVal, configuredWebUiUrlVal) {
        return WidgetUrls.deriveWebUiUrl(
            root.normalizeServerUrl(serverUrlVal), configuredWebUiUrlVal)
    }
}
