pragma ComponentBehavior: Bound

import QtCore as Core
import QtQuick

import "UrlUtils.js" as UrlUtils

QtObject {
    id: root

    required property string settingsId

    readonly property string settingsCategory: settingsId.length > 0
        ? "org.kde.alfc." + settingsId
        : "org.kde.alfc"

    readonly property Core.Settings settings: Core.Settings {
        category: root.settingsCategory
        property string serverUrl: ""
        property string webUiUrl: ""
        property int warningTemp: 90
        property bool compactShowIcon: false
    }

    readonly property string configuredServerUrl: settings.serverUrl.trim()
    readonly property string configuredWebUiUrl: settings.webUiUrl.trim()
    readonly property string serverUrl: UrlUtils.normalizedServerUrl(
        root.configuredServerUrl)
    readonly property string webUiUrl: UrlUtils.deriveWebUiUrl(
        root.serverUrl,
        root.configuredWebUiUrl)
    readonly property int warningTemp: settings.warningTemp
    readonly property bool compactShowIcon: settings.compactShowIcon

    function setConfiguredServerUrl(value) {
        settings.serverUrl = String(value ?? "").trim()
    }

    function setConfiguredWebUiUrl(value) {
        settings.webUiUrl = String(value ?? "").trim()
    }

    function setWarningTemp(value) {
        settings.warningTemp = Math.max(50, Math.min(110, Math.round(value)))
    }

    function setCompactShowIcon(value) {
        settings.compactShowIcon = Boolean(value)
    }
}
