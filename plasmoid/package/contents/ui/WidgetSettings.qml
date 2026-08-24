pragma ComponentBehavior: Bound

import QtQuick
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

    function parseUrl(value) {
        try {
            return new URL(value)
        } catch (_error) {
            return null
        }
    }

    function hasSupportedWebSocketPath(parsedUrl) {
        return parsedUrl !== null
            && parsedUrl.search.length === 0
            && parsedUrl.hash.length === 0
            && /(^|\/)ws\/?$/.test(parsedUrl.pathname)
    }

    function normalizeServerUrl(value) {
        const trimmed = String(value ?? "").trim()
        return trimmed.length > 0 ? trimmed : root.defaultServerUrl
    }

    function isValidWebSocketUrl(value) {
        const trimmed = String(value ?? "").trim()
        if (trimmed.length === 0) {
            return true
        }

        const parsedUrl = root.parseUrl(trimmed)
        return parsedUrl !== null
            && (parsedUrl.protocol === "ws:" || parsedUrl.protocol === "wss:")
            && root.hasSupportedWebSocketPath(parsedUrl)
    }

    function isValidHttpUrl(value) {
        const trimmed = String(value ?? "").trim()
        if (trimmed.length === 0) {
            return true
        }

        const parsedUrl = root.parseUrl(trimmed)
        return parsedUrl !== null
            && (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:")
    }

    function deriveWebUiUrl(serverUrlVal, configuredWebUiUrlVal) {
        const override = String(configuredWebUiUrlVal ?? "").trim()
        if (override.length > 0) {
            return override
        }

        const parsedUrl = root.parseUrl(root.normalizeServerUrl(serverUrlVal))
        if (parsedUrl === null
                || (parsedUrl.protocol !== "ws:"
                    && parsedUrl.protocol !== "wss:")) {
            return ""
        }

        const scheme = parsedUrl.protocol === "wss:" ? "https://" : "http://"
        const host = parsedUrl.host
        const path = parsedUrl.pathname || "/"

        if (path.length === 0 || path === "/") {
            return scheme + host
        }

        if (/\/ws\/?$/.test(path)) {
            const prefix = path.replace(/\/ws\/?$/, "")
            return scheme + host + (prefix.length > 0 ? prefix : "")
        }

        return scheme + host + path
    }
}
