import QtQuick
import QtTest

Item {
    id: fixture
    width: 640
    height: 720
    property var editor: null
    property var editorComponent: null
    property bool plasmaAvailable: false

    QtObject {
        id: backend
        property bool ready: true
        property bool hasState: true
        property bool isConnected: true
        property bool hasFreshActivity: false
        property string url: "ws://first.example/ws"
        property var latestActivity: null
        property var latestState: ({ cpuFanTable: [[40, 30], [90, 100]], gpuFanTable: [[40, 30], [90, 100]] })
        property var saved: null
        signal requestFinished(string requestId, bool ok, string errorMessage, var message)
        function setFanTables(cpu, gpu) {
            saved = { cpu: cpu, gpu: gpu }
            return "save-curves"
        }
    }

    TestCase {
        name: "FanTableEditor"
        when: windowShown

        function initTestCase() {
            try {
                const probe = Qt.createQmlObject(
                    "import QtQml\nimport org.kde.plasma.components\nQtObject {}", fixture)
                probe.destroy()
                fixture.plasmaAvailable = true
            } catch (error) {
                fixture.plasmaAvailable = false
                // Absence is expected in the Qt-only CI image. A present but
                // broken/incompatible plugin must fail, rather than hide lost
                // editor coverage behind the same optional-runtime skip.
                if (alfcTestTier !== "qt-only"
                        || String(error).indexOf('module "org.kde.plasma.components" is not installed') === -1) {
                    fail("Unable to load Plasma components: " + error)
                }
            }
            if (fixture.plasmaAvailable) {
                fixture.editorComponent = Qt.createComponent("./package/contents/ui/FanTableEditor.qml")
                compare(fixture.editorComponent.status, Component.Ready,
                    fixture.editorComponent.errorString())
            }
        }

        function init() {
            if (!fixture.plasmaAvailable) {
                skip("Plasma 6 QML runtime is needed for the fan editor UI tests.")
            }
            backend.saved = null
            backend.ready = true
            backend.url = "ws://first.example/ws"
            backend.hasFreshActivity = false
            backend.latestActivity = null
            backend.latestState = { cpuFanTable: [[40, 30], [90, 100]], gpuFanTable: [[40, 30], [90, 100]] }
            fixture.editor = createTemporaryObject(fixture.editorComponent, fixture,
                { backend: backend, width: 600, height: 700 })
            verify(fixture.editor !== null)
            verify(fixture.editor.loaded)
        }

        function cleanup() {
            if (fixture.editor !== null) {
                fixture.editor.destroy()
                fixture.editor = null
            }
        }

        function test_fractionalSaveAndStateSync() {
            const model = fixture.editor.activeModel()
            fixture.editor.updateValue(model, 0, "temp", "40.5")
            fixture.editor.updateValue(model, 0, "speed", "30.25")
            fixture.editor.validateAndSave()
            compare(backend.saved.cpu[0][0], 40.5)
            compare(backend.saved.cpu[0][1], 30.25)
            verify(fixture.editor.saving)
            verify(!fixture.editor.enabled)
            backend.latestState = { cpuFanTable: backend.saved.cpu, gpuFanTable: backend.saved.gpu }
            backend.requestFinished("save-curves", true, "", null)
            verify(!fixture.editor.saving)
            verify(!fixture.editor.dirty)
            compare(fixture.editor.modelToArray(model)[0][1], 30.25)
        }

        function test_emptyDraftCannotSaveOldValue() {
            fixture.editor.updateValue(fixture.editor.activeModel(), 0, "temp", "")
            fixture.editor.validateAndSave()
            compare(backend.saved, null)
            compare(fixture.editor.statusTone, "error")
            verify(fixture.editor.dirty)
        }

        function test_externalStatePreservesDraftUntilReload() {
            const model = fixture.editor.activeModel()
            fixture.editor.updateValue(model, 0, "speed", "45.5")
            backend.latestState = { cpuFanTable: [[50, 60], [100, 100]], gpuFanTable: [[50, 60], [100, 100]] }
            compare(fixture.editor.modelToArray(model)[0][1], 45.5)
            fixture.editor.syncFromBackend(true)
            compare(fixture.editor.modelToArray(model)[0][1], 60)
            verify(!fixture.editor.dirty)
            compare(fixture.editor.statusMessage, "")
        }

        function test_changingBackendDiscardsPreviousServersDraft() {
            const model = fixture.editor.activeModel()
            fixture.editor.updateValue(model, 0, "speed", "45.5")
            backend.url = "ws://second.example/ws"
            backend.latestState = { cpuFanTable: [[50, 60], [100, 100]], gpuFanTable: [[50, 60], [100, 100]] }
            compare(fixture.editor.modelToArray(model)[0][1], 60)
            verify(!fixture.editor.dirty)
        }

        function test_graphUsesExactFreshTemperature() {
            const canvas = findChild(fixture.editor, "fanCurveCanvas")
            backend.latestActivity = { avgCPUTemp: 65.25, avgGPUTemp: 70.75, appliedSpeed: 30, target: 30 }
            backend.hasFreshActivity = true
            compare(canvas.liveTemperature, 65.25)
            backend.latestActivity = { avgCPUTemp: 65.25, avgGPUTemp: 70.75, appliedSpeed: 30, target: 100, sensorFailure: true }
            compare(canvas.liveTemperature, -1)
            backend.hasFreshActivity = false
            compare(canvas.liveTemperature, -1)
        }

        function test_addPointAtMaximumTemperatureKeepsCurveValid() {
            backend.latestState = { cpuFanTable: [[40, 30], [110, 100]], gpuFanTable: [[40, 30], [110, 100]] }
            fixture.editor.addRow()
            const table = fixture.editor.modelToArray(fixture.editor.activeModel())
            compare(table.length, 3)
            compare(table[1][0], 75)
            compare(table[1][1], 30)
            compare(fixture.editor.validateTable(table, "CPU"), "")
        }

        function test_editorCommandsFitNarrowCard() {
            fixture.editor.width = 300
            const commands = findChild(fixture.editor, "fanCurveCommands")
            waitForRendering(commands)
            compare(commands.columns, 2)
            for (let index = 0; index < commands.children.length; index += 1) {
                const button = commands.children[index]
                verify(button.x >= 0)
                verify(button.x + button.width <= commands.width + 1)
            }
        }

        function test_graphRepaintsWhileAlreadyDirty() {
            const model = fixture.editor.activeModel()
            const canvas = findChild(fixture.editor, "fanCurveCanvas")
            verify(canvas !== null)
            fixture.editor.updateValue(model, 0, "speed", "40")
            waitForRendering(canvas)
            const first = grabImage(canvas)
            fixture.editor.updateValue(model, 0, "speed", "70")
            waitForRendering(canvas)
            verify(!grabImage(canvas).equals(first))
        }

        function test_keyboardFocusSurvivesPointRemovalAndInsertion() {
            const remove = findChild(fixture.editor, "fanCurveRemove-1")
            verify(remove !== null)
            remove.forceActiveFocus()
            keyClick(Qt.Key_Space)
            compare(fixture.editor.activeModel().count, 1)
            const first = findChild(fixture.editor, "fanCurveTemperature-0")
            tryCompare(first, "activeFocus", true)
            fixture.editor.addRow()
            compare(fixture.editor.activeModel().count, 2)
            const added = findChild(fixture.editor, "fanCurveTemperature-1")
            tryCompare(added, "activeFocus", true)
            compare(added.Accessible.name, "CPU fan curve point 2 temperature")
        }
    }
}
