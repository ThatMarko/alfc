pragma ComponentBehavior: Bound

import QtQuick
import QtWebSockets
import "Protocol.js" as Protocol

// Read-only protocol client. Protocol.js is installed from the existing shared
// QML guards in plasmoid/package/contents/ui; there is no hardware access here.
Item {
    id: root

    property string serverUrl: "ws://127.0.0.1:5522/ws"
    readonly property bool validEndpoint: endpointAllowed(serverUrl)
    readonly property bool connected: socket.status === WebSocket.Open
    readonly property bool ready: connected && state !== null
    readonly property bool monitoring: ready && state.isFanControlAvailable !== false
    readonly property bool stale: {
        root.clockTick
        return monitoring && expectedSince > 0
            && Date.now() - Math.max(expectedSince, activityAt) >= staleTimeout
    }
    readonly property string status: {
        if (!validEndpoint) return "configuration"
        if (!connected) return "offline"
        if (protocolError) return "protocol"
        if (!ready) return "waiting"
        if (state.restartRequired === true) return "restart"
        if (!monitoring) return "unavailable"
        if (stale) return "stale"
        if (activity === null || !currentActivity) return "waiting"
        if (activity.sensorFailure === true) return "sensors"
        if (activity.appliedSpeed === null) return "unconfirmed"
        return "online"
    }

    property var state: null
    property var activity: null
    property bool currentActivity: false
    property bool protocolError: false
    property real activityAt: 0
    property real expectedSince: 0
    property real openedAt: 0
    property real pongAt: 0
    property real pingAt: 0
    property real previousTick: 0
    property int clockTick: 0
    property int reconnectDelay: 1000
    property int staleTimeout: 10000
    property int heartbeatInterval: 25000
    property int heartbeatTimeout: 60000
    property int snapshotTimeout: 10000
    property bool stopping: false
    readonly property bool reconnectPending: retry.running

    onServerUrlChanged: reconnect()

    function endpointAllowed(url) {
        const match = /^ws:\/\/(localhost|127\.0\.0\.1|\[::1\]):([0-9]+)\/ws\/?$/.exec(url)
        return match !== null && match[0] === url
            && Number(match[2]) >= 1 && Number(match[2]) <= 65535
    }

    function clearSession() {
        root.state = null
        root.activity = null
        root.currentActivity = false
        root.protocolError = false
        root.activityAt = 0
        root.expectedSince = 0
        root.openedAt = 0
        root.pongAt = 0
        root.pingAt = 0
        root.previousTick = 0
    }

    function reconnect() {
        retry.stop()
        root.clearSession()
        socket.active = false
        root.reconnectDelay = 1000
        if (!root.stopping && root.endpointAllowed(root.serverUrl)) retry.start()
    }

    function disconnected() {
        root.clearSession()
        if (!root.stopping && root.endpointAllowed(root.serverUrl) && !retry.running) retry.start()
    }

    function receive(message) {
        if (message === "pong") {
            root.pongAt = Date.now()
            return
        }
        // The server already bounds outbound data. Do not parse/retain oversized
        // or invalid input from a foreign process listening on the local port.
        if (message.length > 65536) return
        let envelope
        try { envelope = JSON.parse(message) } catch (_error) { return }
        if (!Protocol.isRecord(envelope)) return
        if (envelope.kind === "state") {
            if (!Protocol.isState(envelope.data)) {
                root.state = null
                root.activity = null
                root.currentActivity = false
                root.protocolError = true
                return
            }
            root.protocolError = false
            root.state = envelope.data
            if (envelope.data.isFanControlAvailable === false) {
                root.expectedSince = 0
                root.currentActivity = false
            } else if (root.expectedSince === 0) {
                root.expectedSince = Date.now()
            }
        } else if (envelope.kind === "fancontrolactivity" && root.monitoring
                   && Protocol.isActivity(envelope.data)) {
            root.activity = envelope.data
            root.activityAt = Date.now()
            root.currentActivity = true
        }
    }

    function tick() {
        const now = Date.now()
        root.clockTick = (root.clockTick + 1) % 2147483647
        // A long pause (including sleep/resume) needs a new snapshot and
        // subscription. Backward clock adjustments also retire this session.
        if (root.previousTick > 0 && (now - root.previousTick > root.heartbeatTimeout
                                      || now < root.previousTick)) {
            root.reconnect()
            return
        }
        root.previousTick = now
        if (now - root.pongAt >= root.heartbeatTimeout
                || (!root.ready && now - root.openedAt >= root.snapshotTimeout)) {
            root.reconnect()
            return
        }
        if (now - root.pingAt >= root.heartbeatInterval) {
            socket.sendTextMessage("ping")
            root.pingAt = now
        }
    }

    WebSocket {
        id: socket
        // Validate at the actual transport boundary too: property bindings can
        // update in a different order during a live settings change.
        url: root.endpointAllowed(root.serverUrl) ? root.serverUrl : ""
        active: root.validEndpoint
        onStatusChanged: {
            if (socket.status === WebSocket.Open) {
                retry.stop()
                root.reconnectDelay = 1000
                root.openedAt = Date.now()
                root.pongAt = root.openedAt
                root.pingAt = root.openedAt
                root.previousTick = root.openedAt
                socket.sendTextMessage('{"kind":"registeractivitysocket"}')
            } else if (socket.status === WebSocket.Closed || socket.status === WebSocket.Error) {
                root.disconnected()
            }
        }
        onTextMessageReceived: function(message) { root.receive(message) }
    }

    Timer {
        id: retry
        interval: root.reconnectDelay
        repeat: false
        onTriggered: {
            if (root.stopping || !root.validEndpoint) return
            root.reconnectDelay = Math.min(30000, root.reconnectDelay * 2)
            socket.active = false
            socket.active = true
        }
    }

    Timer {
        interval: 1000
        repeat: true
        running: root.connected
        onTriggered: root.tick()
    }

    Component.onDestruction: {
        root.stopping = true
        retry.stop()
        socket.active = false
    }
}
