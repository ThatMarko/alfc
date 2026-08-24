.pragma library

const defaultServerUrl = "ws://localhost:5522/ws"

function trimString(value) {
    return String(value ?? "").trim()
}

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

function normalizedServerUrl(value) {
    const trimmed = trimString(value)
    return trimmed.length > 0 ? trimmed : defaultServerUrl
}

function normalizedWebUiUrl(value) {
    return trimString(value)
}

function isValidWebSocketUrl(value) {
    const trimmed = trimString(value)
    if (trimmed.length === 0) {
        return true
    }

    const parsedUrl = parseUrl(trimmed)
    return parsedUrl !== null
        && (parsedUrl.protocol === "ws:" || parsedUrl.protocol === "wss:")
        && hasSupportedWebSocketPath(parsedUrl)
}

function isValidHttpUrl(value) {
    const trimmed = trimString(value)
    if (trimmed.length === 0) {
        return true
    }

    const parsedUrl = parseUrl(trimmed)
    return parsedUrl !== null
        && (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:")
}

function deriveWebUiUrl(serverUrl, configuredWebUiUrl) {
    const override = normalizedWebUiUrl(configuredWebUiUrl)
    if (override.length > 0) {
        return override
    }

    const parsedUrl = parseUrl(normalizedServerUrl(serverUrl))
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
