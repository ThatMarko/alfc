import QtQuick
import QtQuick.Layouts
import QtQuick.Controls as QQC2
import org.kde.plasma.components as PlasmaComponents
import org.kde.kirigami as Kirigami

ColumnLayout {
    id: root
    required property var backend

    property bool loaded: false
    property string statusMessage: ""
    property bool isError: false
    property bool isNeutral: false

    // Current view
    property int currentTab: 0 // 0: CPU, 1: GPU

    ListModel {
        id: cpuModel
    }

    ListModel {
        id: gpuModel
    }

    function loadFromBackend() {
        if (backend && backend.latestState) {
            if (backend.latestState.cpuFanTable) {
                cpuModel.clear()
                var cpu = backend.latestState.cpuFanTable
                for (var i = 0; i < cpu.length; i++) {
                    cpuModel.append({ "temp": cpu[i][0], "speed": cpu[i][1] })
                }
            }
            if (backend.latestState.gpuFanTable) {
                gpuModel.clear()
                var gpu = backend.latestState.gpuFanTable
                for (var j = 0; j < gpu.length; j++) {
                    gpuModel.append({ "temp": gpu[j][0], "speed": gpu[j][1] })
                }
            }
            loaded = true
            statusMessage = i18n("Loaded from backend")
            isError = false
            isNeutral = true
        }
    }

    Connections {
        target: backend
        function onLatestStateChanged() {
            if (backend && !loaded && backend.latestState && backend.latestState.cpuFanTable) {
                loadFromBackend()
            }
        }
    }

    Component.onCompleted: {
        if (backend && backend.latestState && backend.latestState.cpuFanTable) {
            loadFromBackend()
        }
    }

    function addRow(isCpu) {
        var model = isCpu ? cpuModel : gpuModel
        var lastTemp = 0
        var lastSpeed = 0
        if (model.count > 0) {
            var lastItem = model.get(model.count - 1)
            lastTemp = parseInt(lastItem.temp)
            lastSpeed = parseInt(lastItem.speed)
        }

        var newTemp = Math.min(110, lastTemp + 10)
        var newSpeed = Math.min(100, lastSpeed + 10)

        model.append({ "temp": newTemp, "speed": newSpeed })
    }

    function removeRow(isCpu, index) {
        var model = isCpu ? cpuModel : gpuModel
        if (model.count > 0) {
            model.remove(index)
        }
    }

    function validateAndSave() {
        var cpuTable = []
        var lastTemp = -1

        // Validate CPU
        for (var i = 0; i < cpuModel.count; i++) {
            var item = cpuModel.get(i)
            var t = parseInt(item.temp)
            var s = parseInt(item.speed)

            if (isNaN(t) || isNaN(s)) {
                statusMessage = i18n("Invalid numbers in CPU table")
                isError = true
                isNeutral = false
                return
            }
            if (t < 0 || t > 110) {
                statusMessage = i18n("CPU temp out of range (0–110)")
                isError = true
                isNeutral = false
                return
            }
            if (s < 0 || s > 100) {
                statusMessage = i18n("CPU speed out of range (0–100)")
                isError = true
                isNeutral = false
                return
            }
            if (i > 0 && t <= lastTemp) {
                statusMessage = i18n("CPU temps must be ascending (row %1)", i + 1)
                isError = true
                isNeutral = false
                return
            }
            lastTemp = t
            cpuTable.push([t, s])
        }

        var gpuTable = []
        lastTemp = -1

        // Validate GPU
        for (var j = 0; j < gpuModel.count; j++) {
            var itemG = gpuModel.get(j)
            var tg = parseInt(itemG.temp)
            var sg = parseInt(itemG.speed)

            if (isNaN(tg) || isNaN(sg)) {
                statusMessage = i18n("Invalid numbers in GPU table")
                isError = true
                isNeutral = false
                return
            }
            if (tg < 0 || tg > 110) {
                statusMessage = i18n("GPU temp out of range (0–110)")
                isError = true
                isNeutral = false
                return
            }
            if (sg < 0 || sg > 100) {
                statusMessage = i18n("GPU speed out of range (0–100)")
                isError = true
                isNeutral = false
                return
            }
            if (j > 0 && tg <= lastTemp) {
                statusMessage = i18n("GPU temps must be ascending (row %1)", j + 1)
                isError = true
                isNeutral = false
                return
            }
            lastTemp = tg
            gpuTable.push([tg, sg])
        }

        // Send
        if (backend) {
            backend.send({
                kind: "fantable",
                methodId: "set_fantable_" + Date.now(),
                methodName: "set_fantable",
                data: {
                    cpu: cpuTable,
                    gpu: gpuTable
                }
            })
            statusMessage = i18n("Configuration sent!")
            isError = false
            isNeutral = false
        } else {
            statusMessage = i18n("Backend not connected")
            isError = true
            isNeutral = false
        }
    }

    // UI Layout
    RowLayout {
        Layout.fillWidth: true
        spacing: 0

        PlasmaComponents.Button {
            text: i18n("CPU Fan Curve")
            checkable: true
            checked: currentTab === 0
            onClicked: currentTab = 0
            Layout.fillWidth: true
        }
        PlasmaComponents.Button {
            text: i18n("GPU Fan Curve")
            checkable: true
            checked: currentTab === 1
            onClicked: currentTab = 1
            Layout.fillWidth: true
        }
    }

    // Header
    RowLayout {
        Layout.fillWidth: true
        Layout.margins: Kirigami.Units.smallSpacing
        PlasmaComponents.Label {
            text: i18n("Temp (°C)")
            Layout.preferredWidth: Kirigami.Units.gridUnit * 5
            font.bold: true
            horizontalAlignment: Text.AlignHCenter
        }
        PlasmaComponents.Label {
            text: i18n("Speed (%)")
            Layout.preferredWidth: Kirigami.Units.gridUnit * 5
            font.bold: true
            horizontalAlignment: Text.AlignHCenter
        }
        Item { Layout.fillWidth: true } // Spacer
    }

    QQC2.ScrollView {
        Layout.fillWidth: true
        Layout.fillHeight: true
        Layout.minimumHeight: Kirigami.Units.gridUnit * 11
        contentWidth: availableWidth
        clip: true

        ColumnLayout {
            width: parent.width
            spacing: Kirigami.Units.smallSpacing

            Repeater {
                model: currentTab === 0 ? cpuModel : gpuModel
                delegate: RowLayout {
                    Layout.fillWidth: true
                    spacing: Kirigami.Units.largeSpacing

                    PlasmaComponents.TextField {
                        text: temp
                        Layout.preferredWidth: Kirigami.Units.gridUnit * 5
                        horizontalAlignment: Text.AlignHCenter
                        validator: IntValidator { bottom: 0; top: 110 }
                        inputMethodHints: Qt.ImhDigitsOnly
                        onEditingFinished: {
                            var model = currentTab === 0 ? cpuModel : gpuModel
                            model.setProperty(index, "temp", parseInt(text))
                        }
                    }

                    PlasmaComponents.TextField {
                        text: speed
                        Layout.preferredWidth: Kirigami.Units.gridUnit * 5
                        horizontalAlignment: Text.AlignHCenter
                        validator: IntValidator { bottom: 0; top: 100 }
                        inputMethodHints: Qt.ImhDigitsOnly
                        onEditingFinished: {
                            var model = currentTab === 0 ? cpuModel : gpuModel
                            model.setProperty(index, "speed", parseInt(text))
                        }
                    }

                    PlasmaComponents.Button {
                        icon.name: "list-remove"
                        Layout.preferredWidth: Kirigami.Units.gridUnit * 2.5
                        onClicked: removeRow(currentTab === 0, index)
                        PlasmaComponents.ToolTip.text: i18n("Remove Row")
                        PlasmaComponents.ToolTip.visible: hovered
                    }

                    Item { Layout.fillWidth: true }
                }
            }

            PlasmaComponents.Button {
                text: i18n("Add Row")
                icon.name: "list-add"
                Layout.alignment: Qt.AlignHCenter
                onClicked: addRow(currentTab === 0)
            }
        }
    }

    RowLayout {
        Layout.fillWidth: true
        Layout.topMargin: Kirigami.Units.largeSpacing

        PlasmaComponents.Button {
            text: i18n("Reload")
            icon.name: "view-refresh"
            onClicked: loadFromBackend()
            PlasmaComponents.ToolTip.text: i18n("Reload from Backend")
            PlasmaComponents.ToolTip.visible: hovered
        }

        Item { Layout.fillWidth: true }

        PlasmaComponents.Button {
            text: i18n("Apply")
            icon.name: "dialog-ok"
            onClicked: validateAndSave()
            PlasmaComponents.ToolTip.text: i18n("Apply Configuration")
            PlasmaComponents.ToolTip.visible: hovered
        }
    }

    PlasmaComponents.Label {
        text: statusMessage
        color: isError
            ? Kirigami.Theme.negativeTextColor
            : (isNeutral
                ? Kirigami.Theme.neutralTextColor
                : (statusMessage === ""
                    ? Kirigami.Theme.textColor
                    : Kirigami.Theme.positiveTextColor))
        visible: text !== ""
        Layout.fillWidth: true
        wrapMode: Text.WordWrap
        horizontalAlignment: Text.AlignHCenter
        font.pointSize: Kirigami.Theme.smallFont.pointSize
        font.family: Kirigami.Theme.smallFont.family
        font.bold: true
    }
}
