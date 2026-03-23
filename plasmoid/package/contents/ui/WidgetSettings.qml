pragma Singleton
pragma ComponentBehavior: Bound

import QtCore
import QtQuick

import "UrlUtils.js" as UrlUtils

QtObject {
    id: root

    readonly property string configuredServerUrl: settings.serverUrl.trim()
    readonly property string serverUrl: UrlUtils.normalizedServerUrl(
        root.configuredServerUrl)
    readonly property int warningTemp: settings.warningTemp
    readonly property bool compactShowIcon: settings.compactShowIcon

    function setConfiguredServerUrl(value) {
        settings.serverUrl = String(value ?? "").trim()
    }

    function setWarningTemp(value) {
        settings.warningTemp = Math.max(50, Math.min(110, Math.round(value)))
    }

    function setCompactShowIcon(value) {
        settings.compactShowIcon = Boolean(value)
    }

    Settings {
        id: settings

        category: "org.kde.alfc"
        property string serverUrl: ""
        property int warningTemp: 90
        property bool compactShowIcon: false
    }
}
