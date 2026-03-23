.pragma library

var defaultServerUrl = "ws://localhost:5522/ws"

function trimString(value) {
    return String(value ?? "").trim()
}

function normalizedServerUrl(value) {
    const trimmed = trimString(value)
    return trimmed.length > 0 ? trimmed : defaultServerUrl
}

function normalizedWebUiUrl(value) {
    return trimString(value)
}

function isValidWebSocketUrl(value) {
    const trimmed = trimString(value)
    return trimmed.length === 0 || /^wss?:\/\/.+/.test(trimmed)
}

function isValidHttpUrl(value) {
    const trimmed = trimString(value)
    return trimmed.length === 0 || /^https?:\/\/.+/.test(trimmed)
}

function deriveWebUiUrl(serverUrl, configuredWebUiUrl) {
    const override = normalizedWebUiUrl(configuredWebUiUrl)
    if (override.length > 0) {
        return override
    }

    const wsUrl = normalizedServerUrl(serverUrl)
    const match = /^(wss?):\/\/([^/]+)(\/.*)?$/.exec(wsUrl)
    if (!match) {
        return ""
    }

    const scheme = match[1] === "wss" ? "https" : "http"
    const host = match[2]
    const path = match[3] || ""

    if (path.length === 0 || path === "/") {
        return scheme + "://" + host
    }

    if (/\/ws\/?$/.test(path)) {
        const prefix = path.replace(/\/ws\/?$/, "")
        return scheme + "://" + host + prefix
    }

    return scheme + "://" + host + path
}
