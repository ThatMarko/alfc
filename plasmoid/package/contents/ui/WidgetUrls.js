.pragma library

function parseUrl(value) {
    try {
        const parsed = new URL(value)
        return parsed.hostname.length > 0 ? parsed : null
    } catch (_error) {
        return null
    }
}

function hasSupportedWebSocketPath(parsed) {
    // Qt's URL implementation returns "#" for an absent fragment, unlike
    // browsers. Check the serialized URL to distinguish it from a bare #.
    return parsed !== null
        && parsed.href.indexOf("?") === -1
        && parsed.href.indexOf("#") === -1
        && /(^|\/)ws\/?$/.test(parsed.pathname)
}

function isValidWebSocketUrl(value) {
    const trimmed = String(value ?? "").trim()
    if (trimmed.length === 0) {
        return true
    }
    const parsed = parseUrl(trimmed)
    return parsed !== null
        && (parsed.protocol === "ws:" || parsed.protocol === "wss:")
        && hasSupportedWebSocketPath(parsed)
}

function isValidHttpUrl(value) {
    const trimmed = String(value ?? "").trim()
    if (trimmed.length === 0) {
        return true
    }
    const parsed = parseUrl(trimmed)
    return parsed !== null && (parsed.protocol === "http:" || parsed.protocol === "https:")
}

function deriveWebUiUrl(serverUrl, override) {
    const configured = String(override ?? "").trim()
    if (configured.length > 0) {
        return isValidHttpUrl(configured) ? configured : ""
    }
    if (!isValidWebSocketUrl(serverUrl)) {
        return ""
    }
    const parsed = parseUrl(serverUrl)
    if (parsed === null) {
        return ""
    }
    // URL.host in Qt omits IPv6 brackets. Use hostname and port explicitly.
    const hostname = parsed.hostname.indexOf(":") >= 0
        ? "[" + parsed.hostname + "]" : parsed.hostname
    const authority = hostname + (parsed.port.length > 0 ? ":" + parsed.port : "")
    // Qt decodes pathname (including %23 and %3F). Preserve the encoded path
    // from href so a proxy prefix cannot become a URL fragment or query.
    const pathStart = parsed.href.indexOf("/", parsed.href.indexOf("://") + 3)
    const encodedPath = pathStart >= 0 ? parsed.href.slice(pathStart) : ""
    const prefix = encodedPath.replace(/\/ws\/?$/, "")
    return (parsed.protocol === "wss:" ? "https://" : "http://") + authority + prefix
}
