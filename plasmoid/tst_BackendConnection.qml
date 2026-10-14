import QtQuick
import QtTest
import QtWebSockets
import "./package/contents/ui" as Widget

Item {
    id: fixture
    width: 640
    height: 480

    property var peer: null
    property var requests: []
    property int subscriptions: 0
    property bool autoReply: false
    property bool autoState: true

    function state() {
        return {
            protocolVersion: "1.1", cpuFanTable: [[40, 30], [90, 100]],
            gpuFanTable: [[40, 30], [90, 100]], doFixedSpeed: false,
            fixedPercentage: 50, gpuBoost: false, pl1: 37, pl2: 106,
            isFanControlAvailable: true, isGpuBoostAvailable: true,
            isCpuTuningAvailable: true
        }
    }

    function push(kind, data) {
        peer.sendTextMessage(JSON.stringify({ kind: kind, data: data }))
    }

    WebSocketServer {
        id: server
        host: "127.0.0.1"
        port: 0
        listen: true
        accept: true
        onClientConnected: function (webSocket) {
            fixture.peer = webSocket
            if (fixture.autoState) {
                fixture.push("state", fixture.state())
            }
        }
    }

    Connections {
        target: fixture.peer
        function onTextMessageReceived(message) {
            if (message === "ping") {
                fixture.peer.sendTextMessage("pong")
                return
            }
            const payload = JSON.parse(message)
            if (payload.kind === "registeractivitysocket") {
                fixture.subscriptions += 1
                return
            }
            fixture.requests = fixture.requests.concat([payload])
            if (fixture.autoReply) {
                fixture.peer.sendTextMessage(JSON.stringify({
                    kind: "success", requestId: payload.requestId, methodId: payload.methodId
                }))
            }
        }
    }

    Component {
        id: backendComponent
        Widget.BackendConnection {
            serverUrl: String(server.url)
            heartbeatInterval: 500
        }
    }

    SignalSpy {
        id: finished
        signalName: "requestFinished"
    }

    TestCase {
        id: tests
        name: "BackendConnection"
        when: windowShown
        property var backend: null

        function init() {
            server.accept = true
            fixture.autoReply = false
            fixture.autoState = true
            fixture.requests = []
            fixture.subscriptions = 0
            backend = createTemporaryObject(backendComponent, fixture)
            verify(backend !== null)
            finished.target = backend
            finished.clear()
            tryCompare(backend, "ready", true)
            tryCompare(fixture, "subscriptions", 1)
        }

        function cleanup() {
            server.accept = true
            finished.target = null
            if (backend !== null) {
                backend.destroy()
                backend = null
            }
            wait(0)
            fixture.peer = null
        }

        function test_requestCorrelation() {
            const first = backend.setGpuBoost(true)
            const second = backend.setGpuBoost(false)
            verify(first !== second)
            tryVerify(function () { return fixture.requests.length === 2 })
            compare(fixture.requests[0].methodId, "129")
            compare(fixture.requests[0].requestId, first)
            fixture.peer.sendTextMessage(JSON.stringify({ kind: "success", requestId: "another-client", methodId: "129" }))
            wait(20)
            compare(finished.count, 0)
            fixture.peer.sendTextMessage(JSON.stringify({ kind: "error", requestId: second, methodId: "129", data: "TEST_ERROR" }))
            fixture.peer.sendTextMessage(JSON.stringify({ kind: "success", requestId: first, methodId: "129" }))
            tryCompare(finished, "count", 2)
            compare(finished.signalArguments[0][0], second)
            compare(finished.signalArguments[0][1], false)
            compare(finished.signalArguments[1][0], first)
            compare(finished.signalArguments[1][1], true)
        }

        function test_timeout() {
            backend.requestTimeout = 30
            const requestId = backend.setFixedPercentage(0)
            tryCompare(finished, "count", 1, 2000)
            compare(finished.signalArguments[0][0], requestId)
            compare(finished.signalArguments[0][1], false)
            verify(finished.signalArguments[0][2].indexOf("timed out") >= 0)
            compare(Object.keys(backend.pendingRequests).length, 0)
        }

        function test_disconnectAndReconnect() {
            const requestId = backend.setFixedPercentage(60)
            tryVerify(function () { return fixture.requests.length === 1 })
            const previousPeer = fixture.peer
            previousPeer.active = false
            tryCompare(finished, "count", 1)
            compare(finished.signalArguments[0][0], requestId)
            compare(finished.signalArguments[0][1], false)
            tryCompare(backend, "ready", true, 4000)
            tryVerify(function () { return fixture.peer !== previousPeer }, 4000)
            tryCompare(fixture, "subscriptions", 2)
            compare(Object.keys(backend.pendingRequests).length, 0)
        }

        function test_reconnectRetainsBackoffAfterManualRetry() {
            server.accept = false
            backend.reconnect()
            wait(200)
            compare(backend.reconnectDelay, 2000)
            verify(!backend.ready)
            wait(200)
            // Assigning Timer.interval = 100 during a manual reconnect used to
            // remove its binding, hammering the backend every 100ms forever.
            compare(backend.reconnectDelay, 2000)
        }

        function test_snapshotValidation() {
            fixture.push("state", {})
            tryCompare(backend, "hasState", false)
            verify(!backend.ready)
            verify(backend.lastError.length > 0)
            fixture.push("state", fixture.state())
            tryCompare(backend, "ready", true)
            const incompatible = fixture.state()
            incompatible.protocolVersion = "2.0"
            fixture.push("state", incompatible)
            tryCompare(backend, "protocolCompatible", false)
            verify(!backend.ready)
            compare(backend.protocolVersion, "2.0")
        }

        function test_activityAndCapabilities() {
            fixture.push("fancontrolactivity", { avgCPUTemp: 0, avgGPUTemp: 65, appliedSpeed: 0, target: 0 })
            tryCompare(backend, "hasFreshActivity", true)
            compare(backend.latestActivity.appliedSpeed, 0)
            fixture.push("fancontrolactivity", { avgCPUTemp: null })
            wait(20)
            compare(backend.latestActivity.avgCPUTemp, 0)
            const unavailable = fixture.state()
            unavailable.isFanControlAvailable = false
            unavailable.restartRequired = true
            fixture.push("state", unavailable)
            tryVerify(function () { return backend.latestState.isFanControlAvailable === false })
            compare(backend.latestState.restartRequired, true)
            const rejected = backend.setFixedPercentage(50)
            tryCompare(finished, "count", 1)
            compare(finished.signalArguments[0][0], rejected)
            compare(finished.signalArguments[0][1], false)
            compare(fixture.requests.length, 0)
        }
    }
}
