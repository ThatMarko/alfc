import QtQuick
import QtTest
import "./package/contents/ui/WidgetUrls.js" as WidgetUrls

TestCase {
    name: "WidgetUrls"

    function test_websocket_data() {
        return [
            { tag: "default", url: "ws://localhost:5522/ws", valid: true },
            { tag: "tls-prefix", url: "wss://example.org/alfc/ws/", valid: true },
            { tag: "ipv6", url: "ws://[::1]:5522/ws", valid: true },
            { tag: "empty-default", url: "", valid: true },
            { tag: "missing-host", url: "ws:///ws", valid: false },
            { tag: "wrong-scheme", url: "http://localhost:5522/ws", valid: false },
            { tag: "wrong-path", url: "ws://localhost:5522/", valid: false },
            { tag: "normalized-endpoint", url: "ws://localhost:5522/%77s", valid: true },
            { tag: "encoded-separator", url: "ws://localhost:5522/prefix%2Fws", valid: false },
            { tag: "encoded-newline", url: "ws://localhost:5522/ws%0A", valid: false },
            { tag: "query", url: "ws://localhost:5522/ws?x=1", valid: false },
            { tag: "empty-query", url: "ws://localhost:5522/ws?", valid: false },
            { tag: "fragment", url: "ws://localhost:5522/ws#x", valid: false },
            { tag: "empty-fragment", url: "ws://localhost:5522/ws#", valid: false }
        ]
    }

    function test_websocket(data) {
        compare(WidgetUrls.isValidWebSocketUrl(data.url), data.valid)
    }

    function test_webUi_data() {
        return [
            { tag: "default", server: "ws://localhost:5522/ws", override: "", expected: "http://localhost:5522" },
            { tag: "tls-prefix", server: "wss://example.org/alfc/ws/", override: "", expected: "https://example.org/alfc" },
            { tag: "ipv6", server: "ws://[::1]:5522/ws", override: "", expected: "http://[::1]:5522" },
            { tag: "encoded-prefix", server: "wss://example.org/my%23prefix/ws", override: "", expected: "https://example.org/my%23prefix" },
            { tag: "override", server: "ws://localhost:5522/ws", override: " https://ui.example.org/ ", expected: "https://ui.example.org/" },
            { tag: "invalid-override", server: "ws://localhost:5522/ws", override: "file:///tmp/example", expected: "" },
            { tag: "invalid-server", server: "ws:///ws", override: "", expected: "" }
        ]
    }

    function test_webUi(data) {
        compare(WidgetUrls.deriveWebUiUrl(data.server, data.override), data.expected)
    }

    function test_httpRequiresHost() {
        verify(WidgetUrls.isValidHttpUrl("https://localhost:5522"))
        verify(!WidgetUrls.isValidHttpUrl("https:///path"))
    }
}
