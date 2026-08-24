pragma ComponentBehavior: Bound

import QtQuick
import QtWebSockets

Item {
    id: root

    required property string serverUrl

    readonly property string url: serverUrl
    readonly property bool isConnected: socket.status === WebSocket.Open
    readonly property bool isConnecting: socket.status === WebSocket.Connecting
    readonly property bool hasState: latestState != null
        && latestState.protocolVersion !== undefined
    readonly property bool hasActivity: latestActivity != null
        && latestActivity.avgCPUTemp !== undefined
    readonly property string protocolVersion: hasState
        && typeof latestState.protocolVersion === "string"
        ? latestState.protocolVersion
        : ""
    readonly property bool protocolCompatible: !hasState
        || root.supportsProtocolVersion(protocolVersion)
    readonly property int activityAgeMs: {
        root.freshnessTick
        return root.lastActivityAt > 0
            ? Math.max(0, Date.now() - root.lastActivityAt)
            : Number.MAX_SAFE_INTEGER
    }
    readonly property bool hasFreshActivity: hasActivity
        && activityAgeMs < activityStaleTimeout

    property string lastError: ""
    property var latestState: null
    property var latestActivity: null
    property real lastPongTime: 0
    property real lastActivityAt: 0
    property real lastStateAt: 0
    property int reconnectDelay: 1000
    property int activityStaleTimeout: 5000
    property int heartbeatInterval: 25000
    property int heartbeatTimeout: 60000
    property int freshnessTick: 0

    signal messageReceived(var message)
    signal requestFinished(
        string requestId,
        bool ok,
        string errorMessage,
        var message
    )

    onUrlChanged: reconnect()

    function supportsProtocolVersion(version) {
        const major = parseInt(String(version).split(".")[0], 10)
        return !Number.isNaN(major) && major === 1
    }

    function clearCachedData() {
        root.latestState = null
        root.latestActivity = null
        root.lastActivityAt = 0
        root.lastStateAt = 0
    }

    function reconnect() {
        reconnectTimer.stop()
        reconnectDelay = 1000
        lastError = ""
        lastPongTime = 0
        clearCachedData()
        keepaliveTimer.stop()
        freshnessTimer.stop()
        socket.active = false
        reconnectTimer.interval = 100
        reconnectTimer.start()
    }

    function restartSocket() {
        socket.active = false
        reconnectTimer.interval = root.reconnectDelay
        reconnectTimer.restart()
    }

    function nextRequestId(prefix) {
        return prefix + "-" + Date.now() + "-" + Math.floor(Math.random() * 100000)
    }

    function send(payload) {
        if (socket.status !== WebSocket.Open) {
            console.warn("BackendConnection: Cannot send, socket is not open")
            return false
        }

        socket.sendTextMessage(JSON.stringify(payload))
        return true
    }

    function sendRequest(kind, data, methodName, methodId) {
        const requestId = methodId || nextRequestId(kind)
        const payload = {
            kind: kind,
            methodId: requestId,
            methodName: methodName || requestId
        }

        if (data !== undefined) {
            payload.data = data
        }

        if (!send(payload)) {
            Qt.callLater(() => {
                root.requestFinished(requestId, false,
                    "Backend connection is not ready.", null)
            })
        }

        return requestId
    }

    function setFixedMode(enabled) {
        return sendRequest("dofixedspeed", enabled, "setMode")
    }

    function setFixedPercentage(percent) {
        return sendRequest("fixedpercentage", Math.round(percent),
            "setFixedPercentage")
    }

    function setFanTables(cpuTable, gpuTable) {
        return sendRequest("fantable", {
            cpu: cpuTable,
            gpu: gpuTable
        }, "setFanTables")
    }

    function setGpuBoost(enabled) {
        return sendRequest("set", {
            Data: enabled ? 1 : 0
        }, "SetAIBoostStatus", "129")
    }

    function applyTune(pl1, pl2) {
        return sendRequest("tune", {
            pl1: Math.round(pl1),
            pl2: Math.round(pl2)
        }, "setCpuTune")
    }

    WebSocket {
        id: socket

        url: root.url
        active: true

        onStatusChanged: {
            if (socket.status === WebSocket.Open) {
                console.info("BackendConnection: Connected to " + root.url)
                root.lastError = ""
                root.lastPongTime = Date.now()
                root.reconnectDelay = 1000
                reconnectTimer.stop()
                keepaliveTimer.start()
                freshnessTimer.start()

                root.send({
                    kind: "registeractivitysocket",
                    methodId: "register-activity",
                    methodName: "RegisterActivitySocket"
                })
            } else if (socket.status === WebSocket.Closed) {
                console.info("BackendConnection: Closed")
                root.lastPongTime = 0
                root.clearCachedData()
                keepaliveTimer.stop()
                freshnessTimer.stop()
                reconnectTimer.start()
            } else if (socket.status === WebSocket.Error) {
                console.error("BackendConnection: Error: " + socket.errorString)
                root.lastError = socket.errorString
                root.lastPongTime = 0
                root.clearCachedData()
                keepaliveTimer.stop()
                freshnessTimer.stop()
                reconnectTimer.start()
            }
        }

        onTextMessageReceived: function(message) {
            if (message === "pong") {
                root.lastPongTime = Date.now()
                return
            }

            try {
                const data = JSON.parse(message)
                if (!data || typeof data !== "object") {
                    return
                }
                root.messageReceived(data)

                if (data.kind === "state") {
                    root.latestState = data.data
                    root.lastStateAt = Date.now()
                    return
                }

                if (data.kind === "fancontrolactivity") {
                    root.latestActivity = data.data
                    root.lastActivityAt = Date.now()
                    return
                }

                if (data.kind === "success") {
                    root.requestFinished(data.methodId || "", true, "", data)
                    return
                }

                if (data.kind === "error") {
                    root.requestFinished(data.methodId || "", false,
                        typeof data.data === "string" ? data.data : "", data)
                }
            } catch (error) {
                console.error("BackendConnection: Parse error: " + error)
            }
        }
    }

    Timer {
        id: reconnectTimer

        interval: root.reconnectDelay
        repeat: false

        onTriggered: {
            console.info("BackendConnection: Connecting...")
            root.reconnectDelay = Math.min(root.reconnectDelay * 2, 30000)
            root.lastPongTime = 0
            socket.active = true
        }
    }

    Timer {
        id: keepaliveTimer

        interval: root.heartbeatInterval
        repeat: true

        onTriggered: {
            if (socket.status === WebSocket.Open) {
                socket.sendTextMessage("ping")
            }
        }
    }

    Timer {
        id: freshnessTimer

        interval: 1000
        repeat: true

        onTriggered: root.freshnessTick += 1
    }

    Timer {
        id: pongWatchdog

        interval: 5000
        repeat: true
        running: keepaliveTimer.running

        onTriggered: {
            if (root.lastPongTime > 0
                    && Date.now() - root.lastPongTime > root.heartbeatTimeout) {
                console.warn("BackendConnection: Pong timeout, forcing reconnect")
                root.reconnect()
            }
        }
    }
}
