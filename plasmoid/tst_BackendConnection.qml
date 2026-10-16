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
            fixture.peer.sendTextMessage(JSON.stringify({ kind: "success", methodId: "129" }))
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

        function test_opcodeOnlyReplyCannotCompleteEvenASingleRequest() {
            const requestId = backend.setFixedPercentage(60)
            tryVerify(function () { return fixture.requests.length === 1 })
            fixture.peer.sendTextMessage(JSON.stringify({ kind: "success", methodId: requestId }))
            wait(20)
            compare(finished.count, 0)
            verify(Object.prototype.hasOwnProperty.call(backend.pendingRequests, requestId))
            fixture.peer.sendTextMessage(JSON.stringify({ kind: "success", requestId: requestId }))
            tryCompare(finished, "count", 1)
            compare(finished.signalArguments[0][1], true)
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

        function test_pendingRequestLimitAndRecovery() {
            const requestIds = []
            for (let index = 0; index < backend.maximumPendingRequests; index += 1) {
                requestIds.push(backend.setFixedPercentage(index % 101))
            }
            tryVerify(function () {
                return fixture.requests.length === backend.maximumPendingRequests
            })
            const rejected = backend.setFixedPercentage(75)
            tryCompare(finished, "count", 1)
            compare(finished.signalArguments[0][0], rejected)
            compare(finished.signalArguments[0][1], false)
            verify(finished.signalArguments[0][2].indexOf("Too many pending") >= 0)
            compare(Object.keys(backend.pendingRequests).length, backend.maximumPendingRequests)
            compare(fixture.requests.length, backend.maximumPendingRequests)

            fixture.peer.sendTextMessage(JSON.stringify({ kind: "success", requestId: requestIds[0] }))
            tryCompare(finished, "count", 2)
            const admitted = backend.setFixedPercentage(80)
            tryVerify(function () {
                return fixture.requests.length === backend.maximumPendingRequests + 1
            })
            compare(fixture.requests[backend.maximumPendingRequests].requestId, admitted)
            compare(Object.keys(backend.pendingRequests).length, backend.maximumPendingRequests)
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
            incompatible.protocolVersion = "1.0"
            fixture.push("state", incompatible)
            tryCompare(backend, "protocolVersion", "1.0")
            verify(!backend.protocolCompatible)
            verify(!backend.ready)
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

        function test_backwardClockChangeRetiresFreshnessAndPendingRequests() {
            fixture.push("fancontrolactivity", {
                avgCPUTemp: 50, avgGPUTemp: 60, appliedSpeed: 30, target: 30
            })
            tryCompare(backend, "hasFreshActivity", true)
            const requestId = backend.setFixedPercentage(60)
            tryVerify(function () { return fixture.requests.length === 1 })
            // Model the session timestamps recorded before a backward wall-
            // clock correction, without changing the host clock or Qt's Date
            // intrinsic. They now lie one hour ahead of the current time.
            const beforeCorrection = Date.now() + 3600000
            backend.lastActivityAt = beforeCorrection
            backend.lastPongTime = beforeCorrection
            verify(!backend.hasFreshActivity)
            backend.lastClockCheckAt = beforeCorrection
            tryCompare(backend, "ready", false, 2000)
            compare(Object.keys(backend.pendingRequests).length, 0)
            compare(finished.count, 1)
            compare(finished.signalArguments[0][0], requestId)
            compare(finished.signalArguments[0][1], false)
            tryCompare(backend, "ready", true)
            tryCompare(fixture, "subscriptions", 2)
            compare(fixture.requests.length, 1)
            verify(!backend.hasActivity)
        }

        function test_initialTelemetryDeadlineIgnoresUnrelatedTraffic() {
            backend.activityStaleTimeout = 100
            const firstStateAt = backend.activityExpectedSince
            verify(firstStateAt > 0)
            verify(!backend.initialActivityTimedOut)
            const firstPongAt = backend.lastPongTime
            for (let index = 0; index < 12; index += 1) {
                fixture.push("state", fixture.state())
                fixture.peer.sendTextMessage("pong")
                fixture.push("fancontrolactivity", { avgCPUTemp: null })
                wait(100)
            }
            verify(backend.initialActivityTimedOut)
            compare(backend.activityExpectedSince, firstStateAt)
            verify(backend.lastStateAt > firstStateAt)
            verify(backend.lastPongTime > firstPongAt)
            verify(backend.ready)
            verify(!backend.hasActivity)
            verify(!backend.hasFreshActivity)
            compare(backend.latestActivity, null)
            compare(backend.lastActivityAt, 0)
        }

        function test_initialTelemetryDeadlineStartsAtValidatedState() {
            fixture.autoState = false
            backend.activityStaleTimeout = 200
            backend.reconnect()
            compare(backend.activityExpectedSince, 0)
            tryCompare(backend, "isConnected", true)
            tryCompare(fixture, "subscriptions", 2)
            fixture.push("state", {})
            wait(250)
            verify(!backend.ready)
            compare(backend.activityExpectedSince, 0)
            verify(!backend.initialActivityTimedOut)

            fixture.push("state", fixture.state())
            tryCompare(backend, "ready", true)
            verify(backend.activityExpectedSince > 0)
            verify(!backend.initialActivityTimedOut)
            wait(50)
            verify(!backend.initialActivityTimedOut)
            tryCompare(backend, "initialActivityTimedOut", true, 2000)
        }

        function test_initialTelemetryRecoversWithoutLosingFailureFlags() {
            backend.activityStaleTimeout = 100
            tryCompare(backend, "initialActivityTimedOut", true, 2000)
            fixture.push("fancontrolactivity", {
                avgCPUTemp: 0, avgGPUTemp: 65, appliedSpeed: 0, target: 100,
                sensorFailure: true
            })
            tryCompare(backend, "hasFreshActivity", true)
            verify(!backend.initialActivityTimedOut)
            compare(backend.latestActivity.appliedSpeed, 0)
            compare(backend.latestActivity.sensorFailure, true)
            tryCompare(backend, "hasFreshActivity", false, 2000)
            verify(backend.hasActivity)
            verify(!backend.initialActivityTimedOut)
            compare(backend.latestActivity.sensorFailure, true)

            fixture.push("fancontrolactivity", {
                avgCPUTemp: 50, avgGPUTemp: 60, appliedSpeed: null, target: 30
            })
            tryCompare(backend, "hasFreshActivity", true)
            verify(!backend.initialActivityTimedOut)
            compare(backend.latestActivity.appliedSpeed, null)
        }

        function test_initialTelemetryDeadlineSurvivesInvalidState() {
            backend.activityStaleTimeout = 100
            const firstStateAt = backend.activityExpectedSince
            const incompatible = fixture.state()
            incompatible.protocolVersion = "2.0"
            fixture.push("state", incompatible)
            tryCompare(backend, "ready", false)
            verify(!backend.initialActivityTimedOut)
            compare(backend.activityExpectedSince, firstStateAt)
            wait(150)

            fixture.push("state", fixture.state())
            tryCompare(backend, "ready", true)
            verify(backend.initialActivityTimedOut)
            compare(backend.activityExpectedSince, firstStateAt)
        }

        function test_initialTelemetryReconnectRestartsDeadline() {
            backend.activityStaleTimeout = 100
            tryCompare(backend, "initialActivityTimedOut", true, 2000)
            const previousStateAt = backend.activityExpectedSince
            backend.activityStaleTimeout = 1000
            backend.reconnect()
            verify(!backend.initialActivityTimedOut)
            compare(backend.activityExpectedSince, 0)
            tryCompare(backend, "ready", true)
            tryCompare(fixture, "subscriptions", 2)
            verify(backend.activityExpectedSince > previousStateAt)
            verify(!backend.initialActivityTimedOut)
            verify(!backend.hasActivity)
            tryCompare(backend, "initialActivityTimedOut", true, 2500)
        }

        function test_initialTelemetryDeadlineTracksLastActivityAfterInvalidState() {
            backend.activityStaleTimeout = 300
            const firstStateAt = backend.activityExpectedSince
            wait(350)
            fixture.push("fancontrolactivity", {
                avgCPUTemp: 50, avgGPUTemp: 60, appliedSpeed: 0, target: 0
            })
            tryCompare(backend, "hasFreshActivity", true)
            const lastActivityAt = backend.lastActivityAt
            fixture.push("state", {})
            tryCompare(backend, "ready", false)
            verify(!backend.hasActivity)
            fixture.push("state", fixture.state())
            tryCompare(backend, "ready", true)
            verify(!backend.initialActivityTimedOut)
            compare(backend.activityExpectedSince, firstStateAt)
            compare(backend.lastActivityAt, lastActivityAt)
            tryCompare(backend, "initialActivityTimedOut", true, 2000)
        }

        function test_initialTelemetryNotExpectedWhenFanControlUnavailable() {
            backend.activityStaleTimeout = 100
            const unavailable = fixture.state()
            unavailable.isFanControlAvailable = false
            unavailable.restartRequired = true
            fixture.push("state", unavailable)
            tryVerify(function () {
                return backend.latestState.isFanControlAvailable === false
            })
            wait(1100)
            verify(!backend.initialActivityTimedOut)
            compare(backend.activityExpectedSince, 0)
            verify(!backend.hasActivity)
            verify(backend.ready)
            verify(backend.latestState.restartRequired)

            backend.setGpuBoost(true)
            tryVerify(function () { return fixture.requests.length === 1 })
            compare(fixture.requests[0].kind, "set")
        }

        function test_fanControlLossPreservesTelemetryWithoutMarkingItFresh() {
            fixture.push("fancontrolactivity", {
                avgCPUTemp: 50, avgGPUTemp: 60, appliedSpeed: 0, target: 100,
                sensorFailure: true
            })
            tryCompare(backend, "hasFreshActivity", true)
            const lastActivityAt = backend.lastActivityAt
            const unavailable = fixture.state()
            unavailable.isFanControlAvailable = false
            unavailable.restartRequired = true
            fixture.push("state", unavailable)
            tryCompare(backend, "hasFreshActivity", false)
            verify(backend.hasActivity)
            compare(backend.latestActivity.sensorFailure, true)
            compare(backend.latestActivity.appliedSpeed, 0)
            compare(backend.lastActivityAt, lastActivityAt)
            verify(backend.ready)
            verify(backend.latestState.restartRequired)
            verify(!backend.initialActivityTimedOut)
            compare(backend.activityExpectedSince, 0)

            fixture.push("state", fixture.state())
            tryVerify(function () { return backend.activityExpectedSince > lastActivityAt })
            verify(!backend.hasFreshActivity)
            verify(backend.hasActivity)
            compare(backend.latestActivity.sensorFailure, true)
            fixture.push("fancontrolactivity", {
                avgCPUTemp: 55, avgGPUTemp: 65, appliedSpeed: 0, target: 0
            })
            tryCompare(backend, "hasFreshActivity", true)
        }

        function test_initialTelemetryStartsWhenFanControlBecomesAvailable_data() {
            return [
                { tag: "explicit-availability", legacy: false },
                { tag: "legacy-availability", legacy: true }
            ]
        }

        function test_initialTelemetryStartsWhenFanControlBecomesAvailable(data) {
            backend.activityStaleTimeout = 400
            const unavailable = fixture.state()
            unavailable.isFanControlAvailable = false
            fixture.push("state", unavailable)
            tryCompare(backend, "activityExpectedSince", 0)
            const unavailableAt = backend.lastStateAt
            wait(500)
            verify(!backend.initialActivityTimedOut)

            const available = fixture.state()
            if (data.legacy) {
                delete available.isFanControlAvailable
            }
            fixture.push("state", available)
            tryVerify(function () { return backend.activityExpectedSince > unavailableAt })
            const expectedSince = backend.activityExpectedSince
            verify(!backend.initialActivityTimedOut)
            wait(50)
            fixture.push("state", available)
            fixture.peer.sendTextMessage("pong")
            tryVerify(function () { return backend.lastStateAt > expectedSince })
            compare(backend.activityExpectedSince, expectedSince)
            verify(!backend.initialActivityTimedOut)
            tryCompare(backend, "initialActivityTimedOut", true, 2000)
        }

        function test_sameMillisecondCapabilityChangeNeedsCurrentPeriodActivity() {
            backend.activityStaleTimeout = 500
            fixture.push("fancontrolactivity", {
                avgCPUTemp: 50, avgGPUTemp: 60, appliedSpeed: 0, target: 100,
                sensorFailure: true
            })
            tryCompare(backend, "hasFreshActivity", true)

            const unavailable = fixture.state()
            unavailable.isFanControlAvailable = false
            fixture.push("state", unavailable)
            tryCompare(backend, "activityExpectedSince", 0)
            verify(!backend.receivedActivityInCurrentPeriod)
            fixture.push("fancontrolactivity", {
                avgCPUTemp: 55, avgGPUTemp: 65, appliedSpeed: 0, target: 0
            })
            wait(20)
            verify(!backend.receivedActivityInCurrentPeriod)
            compare(backend.latestActivity.sensorFailure, true)

            fixture.push("state", fixture.state())
            tryVerify(function () { return backend.activityExpectedSince > 0 })
            // Reproduce equal millisecond timestamps after real socket state
            // transitions. The cached packet still belongs to an earlier period.
            backend.activityExpectedSince = backend.lastActivityAt
            compare(backend.lastActivityAt, backend.activityExpectedSince)
            verify(backend.hasActivity)
            verify(!backend.hasFreshActivity)
            verify(!backend.receivedActivityInCurrentPeriod)
            compare(backend.latestActivity.sensorFailure, true)
            compare(backend.latestActivity.appliedSpeed, 0)
            verify(!backend.initialActivityTimedOut)

            tryCompare(backend, "initialActivityTimedOut", true, 2000)
            fixture.push("fancontrolactivity", {
                avgCPUTemp: 55, avgGPUTemp: 65, appliedSpeed: 0, target: 0
            })
            tryCompare(backend, "hasFreshActivity", true)
            verify(backend.receivedActivityInCurrentPeriod)
            verify(!backend.initialActivityTimedOut)
        }
    }
}
