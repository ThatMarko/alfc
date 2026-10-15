import QtQuick
import QtTest

Item {
    id: fixture
    width: 900
    height: 900
    property var full: null
    property var shell: null
    property var compact: null

    QtObject {
        id: backend
        property bool ready: true
        property bool hasState: true
        property bool isConnected: true
        property bool isConnecting: false
        property bool hasActivity: false
        property bool hasFreshActivity: false
        property bool initialActivityTimedOut: false
        property int activityAgeMs: 0
        property bool modeRequestPending: false
        property bool protocolCompatible: true
        property string protocolVersion: "1.1"
        property string lastError: ""
        property string lastRequestError: ""
        property string url: "ws://first.example/ws"
        property var latestActivity: null
        property var latestState: ({})
        property var calls: []
        signal requestFinished(string requestId, bool ok, string errorMessage, var message)
        function command(kind, value) {
            const id = kind + "-" + calls.length
            calls = calls.concat([{kind: kind, value: value, id: id}])
            return id
        }
        function setFixedMode(value) { return command("mode", value) }
        function setFixedPercentage(value) { return command("fixed", value) }
        function setGpuBoost(value) { return command("boost", value) }
        function applyTune(pl1, pl2) { return command("tune", [pl1, pl2]) }
        function setFanTables(cpu, gpu) { return command("curves", [cpu, gpu]) }
        function reconnect() { command("reconnect", null) }
    }

    TestCase {
        name: "WidgetComponents_ShellBoundary"
        when: windowShown

        function state(changes) {
            return Object.assign({protocolVersion: "1.1", doFixedSpeed: false,
                fixedPercentage: 50, pl1: 37, pl2: 106, gpuBoost: false,
                isFanControlAvailable: true, isCpuTuningAvailable: true,
                isGpuBoostAvailable: true, restartRequired: false,
                cpuFanTable: [[40, 30], [90, 100]], gpuFanTable: [[40, 30], [90, 100]]}, changes)
        }

        function component(name, properties) {
            const definition = Qt.createComponent("file://" + alfcComponentUi + "/" + name + ".qml")
            compare(definition.status, Component.Ready, definition.errorString())
            const item = createTemporaryObject(definition, fixture, properties || {})
            verify(item !== null, definition.errorString())
            return item
        }

        function initTestCase() {
            if (alfcTestTier === "qt-only") return
            // Import failure must fail this required tier, including installed
            // plugin loader/ABI failures. There is no skip in this tier.
            fixture.shell = Qt.createQmlObject('import QtQuick; import org.kde.plasma.plasmoid; QtObject { property var api: Plasmoid }', fixture)
        }

        function init() {
            if (alfcTestTier === "qt-only") skip("Explicit Qt-only tier; real Plasma/Kirigami controls run in the required component job.")
            backend.calls = []
            backend.isConnected = true
            backend.ready = true
            backend.hasState = true
            backend.hasActivity = false
            backend.hasFreshActivity = false
            backend.initialActivityTimedOut = false
            backend.protocolCompatible = true
            backend.latestActivity = null
            backend.url = "ws://first.example/ws"
            backend.latestState = state({})
            fixture.full = component("FullRepresentation", {backend: backend,
                webUiUrl: "http://localhost:5522", isPlanar: false,
                warningTemp: 90, width: 700, height: 850})
            waitForRendering(fixture.full)
        }

        function cleanup() {
            // Temporary objects are destroyed by QtTest, removing the real
            // component Connections, loaders and feedback timers each case.
            fixture.full = null
            fixture.compact = null
        }

        function test_pendingOperationsAreIndependentAndCorrelated() {
            fixture.full.requestMode("fixed")
            fixture.full.requestFixedPercentage()
            fixture.full.requestTune()
            verify(fixture.full.modeBusy)
            verify(fixture.full.fixedBusy)
            verify(fixture.full.tuningBusy)
            backend.requestFinished("another-client", true, "", null)
            verify(fixture.full.modeBusy)
            backend.requestFinished(fixture.full.pendingFixedRequestId, false, "Disk full", null)
            verify(!fixture.full.fixedBusy)
            verify(fixture.full.modeBusy)
            verify(fixture.full.tuningBusy)
            verify(fixture.full.feedbackText.indexOf("Disk full") !== -1)
        }

        function test_pendingBoostUsesRealAccessibleControl() {
            const control = findChild(fixture.full, "gpuBoostSwitch")
            verify(control !== null)
            compare(control.Accessible.name, "GPU boost")
            control.clicked()
            verify(fixture.full.boostBusy)
            verify(!control.enabled)
            fixture.full.requestFixedPercentage()
            verify(fixture.full.fixedBusy)
            backend.requestFinished(fixture.full.pendingBoostRequestId, false, "Unavailable", null)
            verify(!fixture.full.boostBusy)
            verify(fixture.full.fixedBusy)
        }

        function test_disconnectRetiresRequestsWithoutReplay() {
            fixture.full.requestMode("fixed")
            fixture.full.requestFixedPercentage()
            const id = fixture.full.pendingModeRequestId
            backend.isConnected = false
            verify(!fixture.full.modeBusy)
            verify(!fixture.full.fixedBusy)
            verify(fixture.full.feedbackText.indexOf("Connection lost") !== -1)
            backend.requestFinished(id, true, "", null)
            backend.isConnected = true
            compare(backend.calls.length, 2)
            verify(!fixture.full.modeBusy)
        }

        function test_unrelatedAuthoritativeFieldsPreserveDrafts() {
            fixture.full.draftFixedPercentage = "63"
            fixture.full.fixedDraftDirty = true
            fixture.full.draftPl1 = "45"
            fixture.full.pl1DraftDirty = true
            backend.latestState = state({gpuBoost: true})
            compare(fixture.full.draftFixedPercentage, "63")
            compare(fixture.full.draftPl1, "45")
        }

        function test_changedAuthoritativeFieldResynchronizesOnlyThatDraft() {
            fixture.full.draftFixedPercentage = "63"
            fixture.full.fixedDraftDirty = true
            fixture.full.draftPl1 = "45"
            fixture.full.pl1DraftDirty = true
            const field = findChild(fixture.full, "fixedPercentageField")
            field.forceActiveFocus()
            field.text = "63"
            backend.latestState = state({fixedPercentage: 72})
            compare(fixture.full.draftFixedPercentage, "72")
            compare(field.text, "72")
            verify(!fixture.full.fixedDraftDirty)
            compare(fixture.full.draftPl1, "45")
            verify(fixture.full.pl1DraftDirty)
        }

        function test_newEndpointLoadsItsOwnDrafts() {
            fixture.full.draftFixedPercentage = "63"
            fixture.full.fixedDraftDirty = true
            fixture.full.requestFixedPercentage()
            const interrupted = fixture.full.pendingFixedRequestId
            verify(fixture.full.fixedBusy)
            backend.isConnected = false
            verify(!fixture.full.fixedBusy)
            backend.url = "ws://second.example/ws"
            backend.latestState = state({fixedPercentage: 80, pl1: 40})
            backend.isConnected = true
            compare(fixture.full.draftFixedPercentage, "80")
            compare(fixture.full.draftPl1, "40")
            verify(!fixture.full.fixedDraftDirty)
            backend.requestFinished(interrupted, true, "", null)
            compare(fixture.full.draftFixedPercentage, "80")
            compare(backend.calls.length, 1)
        }

        function test_capabilityLossBlocksOnlyAffectedRequests() {
            backend.latestState = state({isFanControlAvailable: false, restartRequired: true})
            fixture.full.requestMode("fixed")
            fixture.full.requestFixedPercentage()
            compare(backend.calls.length, 0)
            fixture.full.requestTune()
            compare(backend.calls.length, 1)
            verify(fixture.full.restartRequired)
            compare(fixture.full.connectionSummaryText, "Fan control unavailable")
        }

        function test_missingStaleFailedAndUnconfirmedTelemetry() {
            compare(fixture.full.connectionSummaryText, "Connected, waiting for telemetry")
            backend.initialActivityTimedOut = true
            compare(fixture.full.connectionSummaryText, "Telemetry unavailable")
            backend.initialActivityTimedOut = false
            backend.latestActivity = {avgCPUTemp: 55, avgGPUTemp: 60, appliedSpeed: null, target: 50}
            backend.hasActivity = true
            backend.activityAgeMs = 12500
            compare(fixture.full.connectionSummaryText, "Telemetry stale")
            compare(fixture.full.safeActivity.appliedSpeed, null)
            backend.hasFreshActivity = true
            compare(fixture.full.connectionSummaryText, "Live telemetry")
            backend.latestActivity = Object.assign({}, backend.latestActivity, {sensorFailure: true})
            compare(fixture.full.connectionSummaryText, "Sensor error")
        }

        function test_fixedFieldHasKeyboardNameAndAcceptsKeyboardApply() {
            const field = findChild(fixture.full, "fixedPercentageField")
            verify(field !== null)
            compare(field.Accessible.name, "Fixed fan speed percentage")
            field.forceActiveFocus()
            verify(field.activeFocus)
            keyClick(Qt.Key_A, Qt.ControlModifier)
            keyClick(Qt.Key_6)
            keyClick(Qt.Key_1)
            keyClick(Qt.Key_Return)
            compare(backend.calls[0].kind, "fixed")
            compare(backend.calls[0].value, 61)
        }

        function makeCompact() {
            const definition = Qt.createQmlObject('import QtQuick; import org.kde.plasma.plasmoid; PlasmoidItem {}', fixture)
            fixture.compact = component("CompactRepresentation", {backend: backend,
                plasmoidItem: definition, width: 250, height: 40})
            return fixture.compact
        }

        function test_compactStatesAndKeyboardActivation() {
            const item = makeCompact()
            const activation = createTemporaryQmlObject('import QtTest; SignalSpy {}', fixture)
            activation.target = fixture.shell.api
            activation.signalName = "activated"
            compare(item.primaryText, "Waiting")
            backend.initialActivityTimedOut = true
            compare(item.primaryText, "No telemetry")
            backend.latestState = state({restartRequired: true})
            compare(item.primaryText, "Restart ALFC")
            item.forceActiveFocus()
            keyClick(Qt.Key_Space)
            compare(activation.count, 1)
            backend.isConnected = false
            compare(item.primaryText, "ALFC")
            compare(item.secondaryText, "Offline")
        }

        function test_compactPanelAndDesktopWidths() {
            const item = makeCompact()
            item.width = 32
            verify(!item.showHorizontalPanelDetails)
            item.width = 600
            verify(item.showHorizontalPanelDetails)
            item.iconOnly = true
            verify(!item.showHorizontalPanelDetails)
            item.iconOnly = false
            // Actual PlasmaCore enum; the shell fixture only owns formFactor.
            fixture.shell.api.formFactor = 3
            verify(item.verticalPanel)
            item.height = 400
            verify(item.showVerticalPanelDetails)
            fixture.shell.api.formFactor = 2
        }

        function test_narrowAndDesktopFullLayouts() {
            fixture.full.width = 400
            verify(!fixture.full.isWide)
            fixture.full.isPlanar = true
            fixture.full.width = 900
            verify(fixture.full.isWide)
            fixture.full.setFeedback("A long translated diagnostic. ".repeat(30), "error")
            waitForRendering(fixture.full)
            verify(fixture.full.implicitWidth >= 0)
        }

        function test_configAliasesValidationAndSettingsUpdates() {
            const config = component("ConfigGeneral", {width: 500})
            config.cfg_serverUrl = "ws://[::1]:5522/ws/"
            config.cfg_webUiUrl = ""
            config.cfg_warningTemp = 100
            config.cfg_compactShowIcon = true
            verify(config.serverUrlValid)
            compare(config.derivedWebUiUrl, "http://[::1]:5522")
            config.cfg_serverUrl = "file:///etc/passwd"
            verify(!config.serverUrlValid)
            config.cfg_serverUrl = "ws://localhost:5522/ws"
            config.cfg_webUiUrl = "javascript:alert(1)"
            verify(!config.webUiUrlValid)
            const settings = component("WidgetSettings", {})
            fixture.shell.api.configuration.serverUrl = " ws://[::1]:5522/ws "
            fixture.shell.api.configuration.warningTemp = config.cfg_warningTemp
            fixture.shell.api.configuration.compactShowIcon = config.cfg_compactShowIcon
            compare(settings.serverUrl, "ws://[::1]:5522/ws")
            compare(settings.warningTemp, 100)
            verify(settings.compactShowIcon)
            // Settings batches notified-property writes; sync alone flushes
            // QSettings, not the still-pending property-write timer.
            tryVerify(function() {
                return String(fixture.shell.api.configuration.value("serverUrl", "")).trim()
                    === "ws://[::1]:5522/ws"
            })
            fixture.shell.api.configuration.sync()
            // A fresh real QSettings reader verifies stored adapter values.
            // Plasma's KConfig dialog remains a session gate.
            const reloaded = createTemporaryQmlObject('import QtCore; Settings { location: "file://" + alfcSettingsFile; category: "General"; property string serverUrl: ""; property int warningTemp: 90; property bool compactShowIcon: false }', fixture)
            reloaded.sync()
            compare(reloaded.serverUrl.trim(), "ws://[::1]:5522/ws")
            compare(reloaded.warningTemp, 100)
            verify(reloaded.compactShowIcon)
            compare(findChild(config, "serverUrlField").Accessible.name, "Server URL")
            compare(findChild(config, "webUiUrlField").Accessible.name, "Web interface URL")
        }
    }
}
