pragma ComponentBehavior: Bound

import QtQuick
import QtWebSockets
import "Protocol.js" as Protocol

Item {
    id: root

    required property string serverUrl

    readonly property string url: serverUrl
    readonly property bool isConnected: socket.status === WebSocket.Open
    readonly property bool isConnecting: socket.status === WebSocket.Connecting
    readonly property bool hasState: latestState != null
    readonly property bool hasActivity: latestActivity != null
    readonly property string protocolVersion: receivedProtocolVersion
    readonly property bool protocolCompatible: protocolVersion.length === 0
        || root.supportsProtocolVersion(protocolVersion)
    readonly property bool ready: isConnected && hasState && protocolCompatible
    readonly property bool modeRequestPending: Object.keys(pendingRequests).some(
        function (key) { return root.pendingRequests[key].kind === "dofixedspeed" })
    readonly property int activityAgeMs: {
        root.freshnessTick
        const age = Date.now() - root.lastActivityAt
        return root.lastActivityAt > 0 && age >= 0
            ? Math.min(2147483647, age) : 2147483647
    }
    readonly property bool hasFreshActivity: ready
        && latestState.isFanControlAvailable !== false && hasActivity
        && receivedActivityInCurrentPeriod
        && activityAgeMs < activityStaleTimeout
    readonly property bool initialActivityTimedOut: {
        root.freshnessTick
        const activityExpectedAt = Math.max(root.activityExpectedSince, root.lastActivityAt)
        return root.ready && root.latestState.isFanControlAvailable !== false
            && !root.receivedActivityInCurrentPeriod && root.activityExpectedSince > 0
            && Date.now() - activityExpectedAt >= root.activityStaleTimeout
    }

    property string lastError: ""
    property string lastRequestError: ""
    property string receivedProtocolVersion: ""
    property var pendingRequests: ({})
    readonly property int maximumPendingRequests: 64
    property int requestSequence: 0
    property int requestTimeout: 30000
    property var latestState: null
    property var latestActivity: null
    property real lastPongTime: 0
    property real lastActivityAt: 0
    property real lastStateAt: 0
    property real lastClockCheckAt: 0
    property real activityExpectedSince: 0
    property bool receivedActivityInCurrentPeriod: false
    property int reconnectDelay: 1000
    property bool quickReconnect: false
    property int activityStaleTimeout: 10000
    property int heartbeatInterval: 25000
    property int heartbeatTimeout: 60000
    property int connectionTimeout: 10000
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
        return Protocol.supportsProtocolVersion(version)
    }

    function clearCachedData() {
        connectionWatchdog.stop()
        root.latestState = null
        root.latestActivity = null
        root.lastActivityAt = 0
        root.lastStateAt = 0
        root.lastClockCheckAt = 0
        root.activityExpectedSince = 0
        root.receivedActivityInCurrentPeriod = false
        root.receivedProtocolVersion = ""
    }

    function reconnect() {
        reconnectTimer.stop()
        reconnectDelay = 1000
        lastError = ""
        lastPongTime = 0
        failPendingRequests(i18n("Backend connection was reset before the request completed."))
        clearCachedData()
        keepaliveTimer.stop()
        freshnessTimer.stop()
        socket.active = false
        root.quickReconnect = true
        reconnectTimer.start()
    }

    function nextRequestId(prefix) {
        root.requestSequence += 1
        return prefix + "-" + Date.now() + "-" + root.requestSequence
            + "-" + Math.floor(Math.random() * 100000)
    }

    function send(payload) {
        if (socket.status !== WebSocket.Open) {
            console.warn("BackendConnection: Cannot send, socket is not open")
            return false
        }

        return socket.sendTextMessage(JSON.stringify(payload)) > 0
    }

    function finishRequest(requestId, ok, errorMessage, message) {
        if (!Object.prototype.hasOwnProperty.call(root.pendingRequests, requestId)) {
            return
        }
        const remaining = Object.assign({}, root.pendingRequests)
        delete remaining[requestId]
        root.pendingRequests = remaining
        root.lastRequestError = ok ? "" : errorMessage
        root.requestFinished(requestId, ok, errorMessage, message)
    }

    function failPendingRequests(message) {
        const requestIds = Object.keys(root.pendingRequests)
        for (let index = 0; index < requestIds.length; index += 1) {
            root.finishRequest(requestIds[index], false, message, null)
        }
    }

    function rejectRequest(kind, message) {
        const requestId = root.nextRequestId(kind)
        root.lastRequestError = message
        Qt.callLater(function () {
            root.requestFinished(requestId, false, message, null)
        })
        return requestId
    }

    function sendRequest(kind, data, methodName, methodId) {
        if (!root.ready) {
            return root.rejectRequest(kind, i18n("Backend connection is not ready."))
        }
        if (Object.keys(root.pendingRequests).length >= root.maximumPendingRequests) {
            return root.rejectRequest(kind,
                i18n("Too many pending requests. Wait for the backend before applying more changes."))
        }
        const requestId = nextRequestId(kind)
        const payload = {
            kind: kind,
            methodId: methodId || requestId,
            methodName: methodName || requestId,
            requestId: requestId
        }
        if (data !== undefined) {
            payload.data = data
        }
        root.pendingRequests = Object.assign({}, root.pendingRequests, {
            [requestId]: { kind: kind, sentAt: Date.now() }
        })
        root.lastRequestError = ""
        if (!send(payload)) {
            Qt.callLater(function () {
                root.finishRequest(requestId, false,
                    i18n("Backend connection is not ready."), null)
            })
        }
        return requestId
    }

    function responseRequestId(message) {
        // Protocol 1.1 guarantees requestId echo. An opcode alone cannot
        // distinguish simultaneous requests or a late reply after a timeout.
        return typeof message.requestId === "string" ? message.requestId : ""
    }

    function handleMessage(message) {
        if (message === "pong") {
            root.lastPongTime = Date.now()
            return
        }
        let data
        try {
            data = JSON.parse(message)
        } catch (_error) {
            console.warn("BackendConnection: Ignoring invalid JSON")
            return
        }
        if (!Protocol.isRecord(data)) {
            return
        }
        if (data.kind === "state") {
            root.receivedProtocolVersion = Protocol.isRecord(data.data)
                && typeof data.data.protocolVersion === "string"
                ? data.data.protocolVersion : ""
            if (!Protocol.isState(data.data)) {
                root.latestState = null
                root.latestActivity = null
                root.receivedActivityInCurrentPeriod = false
                root.lastError = root.protocolCompatible
                    ? i18n("The backend sent an invalid state snapshot.")
                    : i18n("Unsupported backend protocol %1. This widget requires ALFC 1.1 or a newer 1.x version.",
                        root.protocolVersion)
                root.failPendingRequests(root.lastError)
                // A later invalidation also retires readiness. Repeated bad
                // snapshots must not postpone an already-running deadline.
                if (root.isConnected) connectionWatchdog.start()
                return
            }
            connectionWatchdog.stop()
            root.lastError = ""
            root.latestState = data.data
            root.lastStateAt = Date.now()
            // Monitoring stops when fan control is unavailable. Start a grace
            // period when it becomes available, without extending it for state
            // updates or pongs on a connection that already expects telemetry.
            if (data.data.isFanControlAvailable === false) {
                root.activityExpectedSince = 0
                root.receivedActivityInCurrentPeriod = false
            } else if (root.activityExpectedSince === 0) {
                root.activityExpectedSince = root.lastStateAt
            }
        } else if (data.kind === "fancontrolactivity") {
            if (!root.ready || root.latestState.isFanControlAvailable === false
                    || !Protocol.isActivity(data.data)) {
                return
            }
            root.latestActivity = data.data
            root.lastActivityAt = Date.now()
            root.receivedActivityInCurrentPeriod = true
        } else if (data.kind === "success" || data.kind === "error") {
            // Correlation alone does not validate a reply. Match the web
            // client's envelope guard while retaining optional legacy fields.
            if (typeof data.requestId !== "string" || data.requestId.length === 0
                    || (data.methodId !== undefined && typeof data.methodId !== "string")
                    || (data.methodName !== undefined && typeof data.methodName !== "string")
                    || (data.kind === "error" && typeof data.data !== "string")) {
                return
            }
            root.finishRequest(root.responseRequestId(data), data.kind === "success",
                data.kind === "error" ? data.data : "", data)
        } else {
            return
        }
        root.messageReceived(data)
    }

    function setFixedMode(enabled) {
        if (!root.ready || root.latestState.isFanControlAvailable === false
                || typeof enabled !== "boolean" || root.modeRequestPending) {
            return root.rejectRequest("dofixedspeed", i18n("Fan mode control is not ready."))
        }
        return sendRequest("dofixedspeed", enabled, "setMode")
    }

    function setFixedPercentage(percent) {
        if (!root.ready || root.latestState.isFanControlAvailable === false
                || !Protocol.isIntegerInRange(percent, 0, 100)) {
            return root.rejectRequest("fixedpercentage", i18n("Enter a whole fan speed from 0 to 100%."))
        }
        return sendRequest("fixedpercentage", percent,
            "setFixedPercentage")
    }

    function setFanTables(cpuTable, gpuTable) {
        if (!root.ready || root.latestState.isFanControlAvailable === false
                || !Protocol.isFanTable(cpuTable) || !Protocol.isFanTable(gpuTable)) {
            return root.rejectRequest("fantable", i18n("Fan curves are invalid or fan control is unavailable."))
        }
        return sendRequest("fantable", {
            cpu: cpuTable,
            gpu: gpuTable
        }, "setFanTables")
    }

    function setGpuBoost(enabled) {
        if (!root.ready || root.latestState.isGpuBoostAvailable !== true
                || typeof enabled !== "boolean") {
            return root.rejectRequest("set", i18n("GPU boost is not available on this system."))
        }
        return sendRequest("set", {
            Data: enabled ? 1 : 0
        }, "SetAIBoostStatus", "129")
    }

    function applyTune(pl1, pl2) {
        if (!root.ready || root.latestState.isCpuTuningAvailable !== true
                || !Protocol.isIntegerInRange(pl1, 0, 200)
                || !Protocol.isIntegerInRange(pl2, 0, 200)) {
            return root.rejectRequest("tune", i18n("Enter whole CPU power limits from 0 to 200 watts."))
        }
        return sendRequest("tune", {
            pl1: pl1,
            pl2: pl2
        }, "setCpuTune")
    }

    WebSocket {
        id: socket

        url: root.url
        active: true

        onStatusChanged: {
            if (socket.status === WebSocket.Connecting) {
                reconnectTimer.stop()
                connectionWatchdog.restart()
            } else if (socket.status === WebSocket.Open) {
                console.info("BackendConnection: Connected")
                root.lastError = ""
                root.lastPongTime = Date.now()
                root.lastClockCheckAt = root.lastPongTime
                root.reconnectDelay = 1000
                reconnectTimer.stop()
                // Completing the handshake starts a separate grace period
                // for this connection's first validated settings snapshot.
                connectionWatchdog.restart()
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
                root.failPendingRequests(i18n("Connection lost before the request completed."))
                root.clearCachedData()
                keepaliveTimer.stop()
                freshnessTimer.stop()
                reconnectTimer.start()
            } else if (socket.status === WebSocket.Error) {
                console.error("BackendConnection: Error: " + socket.errorString)
                root.lastError = socket.errorString
                root.lastPongTime = 0
                root.failPendingRequests(i18n("Connection lost before the request completed."))
                root.clearCachedData()
                keepaliveTimer.stop()
                freshnessTimer.stop()
                reconnectTimer.start()
            }
        }

        onTextMessageReceived: function(message) {
            root.handleMessage(message)
        }
    }

    Timer {
        id: reconnectTimer

        interval: root.quickReconnect ? 100 : root.reconnectDelay
        repeat: false

        onTriggered: {
            console.info("BackendConnection: Connecting...")
            root.quickReconnect = false
            root.reconnectDelay = Math.min(root.reconnectDelay * 2, 30000)
            root.lastPongTime = 0
            // active remains true after a remote close/error; changing it is
            // required for QtWebSockets to open a new connection.
            socket.active = false
            // Qt may retain Connecting across cancellation/retry without a
            // new status notification. Every activation owns a deadline.
            connectionWatchdog.restart()
            socket.active = true
        }
    }

    Timer {
        id: connectionWatchdog

        interval: root.connectionTimeout
        repeat: false

        onTriggered: {
            console.warn("BackendConnection: Connection readiness timed out, forcing reconnect")
            root.reconnect()
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

        onTriggered: {
            const now = Date.now()
            // Wall-clock corrections must not keep old telemetry fresh or
            // postpone pending-request/pong deadlines until the clock catches
            // up. A new session establishes timestamps in the corrected clock.
            if (now < root.lastClockCheckAt) {
                root.reconnect()
                return
            }
            root.lastClockCheckAt = now
            root.freshnessTick = (root.freshnessTick + 1) % 2147483647
            const requestIds = Object.keys(root.pendingRequests)
            for (let index = 0; index < requestIds.length; index += 1) {
                const requestId = requestIds[index]
                if (now - root.pendingRequests[requestId].sentAt >= root.requestTimeout) {
                    root.finishRequest(requestId, false,
                        i18n("Request timed out. The backend may still apply the change."), null)
                }
            }
        }
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
