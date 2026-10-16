import QtQuick
import QtTest
import QtWebSockets
import "./module" as Alfc

Item {
    id: fixture
    width: 640
    height: 480

    property var peers: []
    property var handlers: []
    property int subscriptions: 0
    property int writes: 0
    property int connections: 0
    property bool autoState: true
    property bool replyPings: true
    // run_tests.py supplies an ephemeral real TCP peer that sends no handshake.
    readonly property string silentEndpoint: "@ALFC_SILENT_HANDSHAKE_ENDPOINT@"

    function snapshot() {
        return { protocolVersion: "1.1", cpuFanTable: [[40,30],[90,100]],
            gpuFanTable: [[40,30],[90,100]], doFixedSpeed: false,
            fixedPercentage: 50, gpuBoost: false, pl1: 37, pl2: 106,
            isFanControlAvailable: true, isGpuBoostAvailable: true,
            isCpuTuningAvailable: true }
    }
    function activity() {
        return { avgCPUTemp: 51, avgGPUTemp: 63, appliedSpeed: 35, target: 40 }
    }
    function push(peer, kind, data) { peer.sendTextMessage(JSON.stringify({ kind: kind, data: data })) }
    function lastPeer() { return peers[peers.length - 1] }
    function endpoint() { return String(server.url).replace(/\/?$/, "/ws") }

    WebSocketServer {
        id: server
        host: "127.0.0.1"
        port: 0
        listen: true
        accept: true
        onClientConnected: function(peer) {
            fixture.peers = fixture.peers.concat([peer])
            fixture.connections += 1
            fixture.handlers = fixture.handlers.concat([handler.createObject(fixture, { peer: peer })])
            if (fixture.autoState) fixture.push(peer, "state", fixture.snapshot())
        }
    }
    Component {
        id: handler
        Connections {
            required property var peer
            target: peer
            function onTextMessageReceived(message) {
                if (message === "ping") {
                    if (fixture.replyPings) peer.sendTextMessage("pong")
                    return
                }
                const payload = JSON.parse(message)
                if (payload.kind === "registeractivitysocket") fixture.subscriptions += 1
                else fixture.writes += 1
            }
        }
    }
    Component { id: backendComponent; Alfc.Backend {} }
    Component { id: widgetComponent; Alfc.Widget {} }

    TestCase {
        id: tests
        name: "OmarchyStatus"
        when: windowShown
        property var backend: null
        property var extra: null
        property var launched: []

        function init() {
            fixture.autoState = true
            fixture.replyPings = true
            fixture.subscriptions = 0
            fixture.connections = 0
            fixture.writes = 0
            launched = []
            server.listen = true
            server.accept = true
            backend = createTemporaryObject(backendComponent, fixture, { serverUrl: fixture.endpoint() })
            verify(backend !== null)
            tryCompare(backend, "ready", true)
            tryCompare(fixture, "subscriptions", 1)
        }
        function cleanup() {
            if (backend) backend.destroy()
            if (extra) extra.destroy()
            backend = null
            extra = null
            wait(10)
            compare(fixture.writes, 0)
            for (const connection of fixture.handlers) connection.destroy()
            for (const peer of fixture.peers) peer.active = false
            fixture.handlers = []
            fixture.peers = []
        }
        function test_initialWaitingAndTelemetry() {
            compare(backend.status, "waiting")
            compare(backend.activity, null)
            fixture.push(fixture.lastPeer(), "fancontrolactivity", fixture.activity())
            tryCompare(backend, "status", "online")
            compare(backend.activity.appliedSpeed, 35)
            backend.activityAt -= backend.staleTimeout
            backend.expectedSince -= backend.staleTimeout
            backend.tick()
            compare(backend.status, "stale")
        }
        function test_stateAndPongsNeverRefreshTelemetry() {
            const expected = backend.expectedSince
            backend.expectedSince -= backend.staleTimeout
            const expired = backend.expectedSince
            fixture.push(fixture.lastPeer(), "state", fixture.snapshot())
            fixture.lastPeer().sendTextMessage("pong")
            fixture.push(fixture.lastPeer(), "fancontrolactivity", { avgCPUTemp: null })
            wait(30)
            backend.tick()
            verify(expected > expired)
            compare(backend.expectedSince, expired)
            compare(backend.status, "stale")
            compare(backend.activity, null)
        }
        function test_invalidBoundaryAndRecovery() {
            fixture.lastPeer().sendTextMessage("invalid json")
            fixture.lastPeer().sendTextMessage("[]")
            fixture.push(fixture.lastPeer(), "state", { protocolVersion: "2.0" })
            tryCompare(backend, "status", "protocol")
            verify(!backend.ready)
            fixture.push(fixture.lastPeer(), "state", fixture.snapshot())
            tryCompare(backend, "ready", true)
            fixture.push(fixture.lastPeer(), "fancontrolactivity", fixture.activity())
            tryCompare(backend, "status", "online")
            fixture.push(fixture.lastPeer(), "fancontrolactivity", { avgCPUTemp: "<b>bad</b>" })
            fixture.lastPeer().sendTextMessage("x".repeat(65537))
            wait(30)
            compare(backend.status, "online")
            compare(backend.activity.avgCPUTemp, 51)
        }
        function test_failuresAreDistinctFromZero() {
            const packet = fixture.activity()
            packet.appliedSpeed = 0
            fixture.push(fixture.lastPeer(), "fancontrolactivity", packet)
            tryCompare(backend, "status", "online")
            packet.appliedSpeed = null
            fixture.push(fixture.lastPeer(), "fancontrolactivity", packet)
            tryCompare(backend, "status", "unconfirmed")
            packet.sensorFailure = true
            fixture.push(fixture.lastPeer(), "fancontrolactivity", packet)
            tryCompare(backend, "status", "sensors")
            backend.activityAt -= backend.staleTimeout
            backend.expectedSince -= backend.staleTimeout
            backend.tick()
            compare(backend.status, "stale")
        }
        function test_capabilityLossAndRestart() {
            fixture.push(fixture.lastPeer(), "fancontrolactivity", fixture.activity())
            tryCompare(backend, "status", "online")
            const state = fixture.snapshot()
            state.isFanControlAvailable = false
            fixture.push(fixture.lastPeer(), "state", state)
            tryCompare(backend, "status", "unavailable")
            compare(backend.expectedSince, 0)
            verify(!backend.currentActivity)
            state.restartRequired = true
            fixture.push(fixture.lastPeer(), "state", state)
            tryCompare(backend, "status", "restart")
            fixture.push(fixture.lastPeer(), "state", fixture.snapshot())
            tryCompare(backend, "status", "waiting")
            verify(!backend.currentActivity)
            verify(!backend.stale)
            fixture.push(fixture.lastPeer(), "fancontrolactivity", fixture.activity())
            tryCompare(backend, "status", "online")
        }
        function test_disconnectRestartAndNoReplay() {
            fixture.push(fixture.lastPeer(), "fancontrolactivity", fixture.activity())
            tryCompare(backend, "status", "online")
            fixture.lastPeer().active = false
            tryCompare(backend, "ready", false)
            compare(backend.activity, null)
            tryCompare(backend, "ready", true, 4000)
            tryCompare(fixture, "subscriptions", 2)
            compare(backend.status, "waiting")
            fixture.lastPeer().active = false
            tryCompare(fixture, "subscriptions", 3, 4000)
            compare(fixture.writes, 0)
        }
        function test_backendAbsentThenLateStartup() {
            server.accept = false
            backend.reconnect()
            wait(1200)
            verify(!backend.ready)
            verify(backend.reconnectDelay >= 2000)
            verify(backend.reconnectDelay <= 30000)
            server.accept = true
            tryCompare(backend, "ready", true, 4000)
            tryCompare(fixture, "subscriptions", 2)
            compare(backend.reconnectDelay, 1000)
        }
        function test_sleepResumeRetiresOldSession() {
            fixture.push(fixture.lastPeer(), "fancontrolactivity", fixture.activity())
            tryCompare(backend, "status", "online")
            backend.previousTick -= backend.heartbeatTimeout + 1
            backend.tick()
            verify(!backend.ready)
            compare(backend.activity, null)
            tryCompare(fixture, "subscriptions", 2, 4000)
            compare(backend.status, "waiting")
        }
        function test_missingPongsReconnect() {
            fixture.replyPings = false
            backend.pongAt -= backend.heartbeatTimeout + 1
            backend.tick()
            verify(!backend.ready)
            tryCompare(fixture, "subscriptions", 2, 4000)
        }
        function test_missingSnapshotReconnect() {
            fixture.autoState = false
            backend.reconnect()
            tryCompare(fixture, "subscriptions", 2, 4000)
            verify(!backend.ready)
            backend.openedAt -= backend.snapshotTimeout + 1
            backend.tick()
            fixture.autoState = true
            tryCompare(fixture, "subscriptions", 3, 4000)
            verify(backend.ready)
        }
        function test_silentHandshakeReconnectsAndRecovers_data() {
            return [{ tag: "deadline", clockJump: false }, { tag: "clock-jump", clockJump: true }]
        }
        function test_silentHandshakeReconnectsAndRecovers(data) {
            backend.snapshotTimeout = data.clockJump ? 10000 : 100
            backend.serverUrl = fixture.silentEndpoint
            // Wait past the endpoint-change retry. A genuine accepted TCP
            // connection now remains in Connecting, without a WS Open event.
            tryCompare(backend, "reconnectPending", false, 2000)
            verify(!backend.ready)
            if (data.clockJump) {
                backend.previousTick = Date.now() + 1000
                backend.tick()
            }
            tryCompare(backend, "reconnectPending", true, 2000)
            backend.serverUrl = fixture.endpoint()
            tryCompare(backend, "ready", true, 4000)
            compare(backend.status, "waiting")
        }
        function test_twoClientsAndDestruction() {
            extra = createTemporaryObject(backendComponent, fixture, { serverUrl: fixture.endpoint() })
            verify(extra !== null)
            tryCompare(extra, "ready", true)
            tryCompare(fixture, "subscriptions", 2)
            for (const peer of fixture.peers) fixture.push(peer, "fancontrolactivity", fixture.activity())
            tryCompare(extra, "status", "online")
            tryCompare(backend, "status", "online")
            const previousPeer = fixture.lastPeer()
            extra.destroy()
            extra = null
            tryCompare(previousPeer, "status", WebSocket.Closed)
            const count = fixture.connections
            wait(1200)
            compare(fixture.connections, count)
            verify(backend.ready)
        }
        function test_endpointValidation_data() {
            return [
                { tag: "remote", url: "ws://example.com:5522/ws" },
                { tag: "credentials", url: "ws://user@localhost:5522/ws" },
                { tag: "shell", url: "ws://localhost:5522/ws;touch bad" },
                { tag: "newline", url: "ws://localhost:5522/ws\n" },
                { tag: "query", url: "ws://localhost:5522/ws?x=1" }
            ]
        }
        function test_endpointValidation(data) {
            backend.serverUrl = data.url
            compare(backend.validEndpoint, false)
            compare(backend.status, "configuration")
            verify(!backend.reconnectPending)
        }
        function test_widgetLaunchKeyboardLayoutAndEscaping() {
            extra = createTemporaryObject(widgetComponent, fixture, {
                width: 200, height: 28,
                openUrl: function(url) { tests.launched = tests.launched.concat([url]); return true }
            })
            verify(extra !== null)
            extra.forceActiveFocus()
            keyClick(Qt.Key_Return)
            keyClick(Qt.Key_Space)
            compare(launched.length, 2)
            compare(launched[0], "http://127.0.0.1:5522/")
            extra.settings = { serverUrl: "ws://[::1]:5522/ws/" }
            compare(extra.webUrl, "http://[::1]:5522/")
            extra.settings = { serverUrl: "ws://localhost:5522/ws;$(touch bad)<b>" }
            compare(extra.supportedEndpoint, false)
            compare(extra.connection.status, "configuration")
            verify(extra.tooltipText.indexOf("<b>") < 0)
            compare(extra.webUrl, "http://127.0.0.1:5522/")
            extra.bar = { vertical: true, barSize: 28, foreground: "white", fontFamily: "monospace",
                hideTooltip: function(_target) {}, showTooltip: function(_target, _text) {} }
            compare(extra.implicitWidth, 28)
            compare(extra.implicitHeight, 28)
        }
    }
}
