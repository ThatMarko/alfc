pragma ComponentBehavior: Bound

import QtQuick
import org.kde.plasma.plasmoid

import "UrlUtils.js" as UrlUtils

QtObject {
    id: root

    readonly property string configuredServerUrl: String(Plasmoid.configuration.serverUrl ?? "").trim()
    readonly property string configuredWebUiUrl: String(Plasmoid.configuration.webUiUrl ?? "").trim()
    readonly property string serverUrl: UrlUtils.normalizedServerUrl(root.configuredServerUrl)
    readonly property string webUiUrl: UrlUtils.deriveWebUiUrl(
        root.serverUrl,
        root.configuredWebUiUrl)
    readonly property int warningTemp: Plasmoid.configuration.warningTemp ?? 90
    readonly property bool compactShowIcon: Boolean(Plasmoid.configuration.compactShowIcon)
}
