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
            } catch (_error) {
                fixture.plasmaAvailable = false
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
    }
}
