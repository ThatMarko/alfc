pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Layouts

import org.kde.kirigami as Kirigami
import org.kde.plasma.components as PlasmaComponents

ColumnLayout {
    id: root

    required property var backend

    property bool loaded: false
    property bool dirty: false
    property bool saving: false
    property string pendingRequestId: ""
    property string statusMessage: ""
    property string statusTone: ""
    property int currentTab: 0

    ListModel {
        id: cpuModel
    }

    ListModel {
        id: gpuModel
    }

    function setStatus(message, tone) {
        root.statusMessage = message
        root.statusTone = tone

        if (tone === "success") {
            statusTimer.restart()
        } else {
            statusTimer.stop()
        }
    }

    function clearStatus() {
        root.statusMessage = ""
        root.statusTone = ""
    }

    function populateModel(model, table) {
        model.clear()

        for (let index = 0; index < table.length; index += 1) {
            model.append({
                temp: table[index][0],
                speed: table[index][1]
            })
        }
    }

    function syncFromBackend(force) {
        if (!root.backend || !root.backend.hasState) {
            return
        }

        if (root.dirty && !force) {
            return
        }

        populateModel(cpuModel, root.backend.latestState.cpuFanTable || [])
        populateModel(gpuModel, root.backend.latestState.gpuFanTable || [])

        root.loaded = true
        root.dirty = false

        if (!force) {
            clearStatus()
        }
    }

    function modelToArray(model) {
        const table = []

        for (let index = 0; index < model.count; index += 1) {
            const row = model.get(index)
            table.push([parseInt(row.temp), parseInt(row.speed)])
        }

        return table
    }

    function activeModel() {
        return root.currentTab === 0 ? cpuModel : gpuModel
    }

    function markDirty() {
        root.dirty = true

        if (!root.saving) {
            setStatus(i18n("Unsaved changes"), "neutral")
        }
    }

    function updateValue(model, index, key, value) {
        if (index < 0 || index >= model.count) {
            return
        }

        model.setProperty(index, key, Math.round(value))
        markDirty()
    }

    function addRow() {
        const model = activeModel()
        let newTemp = 40
        let newSpeed = 30

        if (model.count > 0) {
            const lastItem = model.get(model.count - 1)
            newTemp = Math.min(110, parseInt(lastItem.temp) + 5)
            newSpeed = Math.min(100, parseInt(lastItem.speed) + 10)
        }

        model.append({
            temp: newTemp,
            speed: newSpeed
        })
        markDirty()
    }

    function removeRow(index) {
        const model = activeModel()

        if (model.count <= 1 || index < 0 || index >= model.count) {
            return
        }

        model.remove(index)
        markDirty()
    }

    function validateTable(table, label) {
        if (table.length === 0) {
            return i18n("%1 fan curve must contain at least one point.", label)
        }

        let previousTemp = -1

        for (let index = 0; index < table.length; index += 1) {
            const temp = table[index][0]
            const speed = table[index][1]

            if (!Number.isFinite(temp) || !Number.isFinite(speed)) {
                return i18n("%1 fan curve contains invalid numbers.", label)
            }

            if (temp < 0 || temp > 110) {
                return i18n("%1 temperatures must stay between 0 and 110\u00B0C.", label)
            }

            if (speed < 0 || speed > 100) {
                return i18n("%1 speeds must stay between 0 and 100%.", label)
            }

            if (temp <= previousTemp) {
                return i18n("%1 temperatures must be strictly ascending.", label)
            }

            previousTemp = temp
        }

        return ""
    }

    function validateAndSave() {
        const cpuTable = modelToArray(cpuModel)
        const gpuTable = modelToArray(gpuModel)

        const cpuError = validateTable(cpuTable, i18n("CPU"))
        if (cpuError.length > 0) {
            setStatus(cpuError, "error")
            return
        }

        const gpuError = validateTable(gpuTable, i18n("GPU"))
        if (gpuError.length > 0) {
            setStatus(gpuError, "error")
            return
        }

        root.pendingRequestId = root.backend.setFanTables(cpuTable, gpuTable)
        root.saving = root.pendingRequestId.length > 0
        setStatus(i18n("Saving curves…"), "neutral")
    }

    Connections {
        target: root.backend

        function onLatestStateChanged() {
            root.syncFromBackend(false)
        }

        function onRequestFinished(requestId, ok, errorMessage, _message) {
            if (requestId !== root.pendingRequestId) {
                return
            }

            root.pendingRequestId = ""
            root.saving = false

            if (ok) {
                root.syncFromBackend(true)
                root.setStatus(i18n("Curves saved"), "success")
                return
            }

            root.setStatus(
                errorMessage.length > 0
                    ? i18n("Failed to save curves: %1", errorMessage)
                    : i18n("Failed to save curves."),
                "error"
            )
        }
    }

    Component.onCompleted: root.syncFromBackend(false)

    Timer {
        id: statusTimer

        interval: 2500
        onTriggered: root.clearStatus()
    }

    RowLayout {
        Layout.fillWidth: true
        spacing: Kirigami.Units.smallSpacing

        PlasmaComponents.Button {
            text: i18n("CPU")
            checkable: true
            checked: root.currentTab === 0
            onClicked: root.currentTab = 0
            Layout.fillWidth: true
        }

        PlasmaComponents.Button {
            text: i18n("GPU")
            checkable: true
            checked: root.currentTab === 1
            onClicked: root.currentTab = 1
            Layout.fillWidth: true
        }
    }

    PlasmaComponents.Label {
        visible: root.loaded
        text: i18n("Higher CPU/GPU targets win because both fans share heat pipes.")
        color: Kirigami.Theme.disabledTextColor
        font: Kirigami.Theme.smallFont
        wrapMode: Text.WordWrap
        Layout.fillWidth: true
    }

    RowLayout {
        visible: root.loaded
        Layout.fillWidth: true
        spacing: Kirigami.Units.smallSpacing

        PlasmaComponents.Label {
            text: i18n("Temp (\u00B0C)")
            font.bold: true
            Layout.preferredWidth: Kirigami.Units.gridUnit * 5
            horizontalAlignment: Text.AlignHCenter
        }

        PlasmaComponents.Label {
            text: i18n("Speed (%)")
            font.bold: true
            Layout.preferredWidth: Kirigami.Units.gridUnit * 5
            horizontalAlignment: Text.AlignHCenter
        }

        Item {
            Layout.fillWidth: true
        }
    }

    PlasmaComponents.ScrollView {
        id: fanTableScroll

        visible: root.loaded
        Layout.fillWidth: true
        Layout.fillHeight: true
        Layout.minimumHeight: Kirigami.Units.gridUnit * 10
        clip: true

        ColumnLayout {
            width: fanTableScroll.availableWidth
            spacing: Kirigami.Units.smallSpacing

            Repeater {
                model: root.currentTab === 0 ? cpuModel : gpuModel

                delegate: RowLayout {
                    id: row

                    required property int index
                    required property int temp
                    required property int speed

                    Layout.fillWidth: true
                    spacing: Kirigami.Units.smallSpacing

                    PlasmaComponents.TextField {
                        text: row.temp.toString()
                        Layout.preferredWidth: Kirigami.Units.gridUnit * 5
                        horizontalAlignment: Text.AlignHCenter
                        validator: IntValidator {
                            bottom: 0
                            top: 110
                        }
                        inputMethodHints: Qt.ImhDigitsOnly

                        onEditingFinished: {
                            const value = parseInt(text)
                            if (!Number.isNaN(value)) {
                                root.updateValue(root.activeModel(),
                                    row.index, "temp", value)
                            }
                        }
                    }

                    PlasmaComponents.TextField {
                        text: row.speed.toString()
                        Layout.preferredWidth: Kirigami.Units.gridUnit * 5
                        horizontalAlignment: Text.AlignHCenter
                        validator: IntValidator {
                            bottom: 0
                            top: 100
                        }
                        inputMethodHints: Qt.ImhDigitsOnly

                        onEditingFinished: {
                            const value = parseInt(text)
                            if (!Number.isNaN(value)) {
                                root.updateValue(root.activeModel(),
                                    row.index, "speed", value)
                            }
                        }
                    }

                    PlasmaComponents.Button {
                        icon.name: "list-remove"
                        enabled: root.activeModel().count > 1
                        onClicked: root.removeRow(row.index)
                        PlasmaComponents.ToolTip.text: i18n("Remove point")
                        PlasmaComponents.ToolTip.visible: hovered
                    }

                    Item {
                        Layout.fillWidth: true
                    }
                }
            }
        }
    }

    PlasmaComponents.Label {
        visible: !root.loaded
        text: i18n("Waiting for fan curve data…")
        color: Kirigami.Theme.disabledTextColor
        font: Kirigami.Theme.smallFont
        Layout.fillWidth: true
        horizontalAlignment: Text.AlignHCenter
    }

    RowLayout {
        Layout.fillWidth: true

        PlasmaComponents.Button {
            text: i18n("Add Point")
            icon.name: "list-add"
            enabled: root.loaded
            onClicked: root.addRow()
        }

        PlasmaComponents.Button {
            text: i18n("Reload")
            icon.name: "view-refresh"
            enabled: root.backend != null && root.backend.hasState
            onClicked: root.syncFromBackend(true)
        }

        Item {
            Layout.fillWidth: true
        }

        PlasmaComponents.Button {
            text: root.saving ? i18n("Saving…") : i18n("Apply Curves")
            icon.name: "dialog-ok"
            enabled: root.loaded && !root.saving
            onClicked: root.validateAndSave()
        }
    }

    PlasmaComponents.Label {
        visible: root.statusMessage.length > 0
        text: root.statusMessage
        color: root.statusTone === "error"
            ? Kirigami.Theme.negativeTextColor
            : (root.statusTone === "success"
                ? Kirigami.Theme.positiveTextColor
                : Kirigami.Theme.disabledTextColor)
        font: Kirigami.Theme.smallFont
        wrapMode: Text.WordWrap
        Layout.fillWidth: true
    }
}
