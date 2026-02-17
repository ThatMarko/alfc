import QtQuick
import QtQuick.Layouts
import QtQuick.Controls as QQC2
import org.kde.plasma.components as PlasmaComponents

ColumnLayout {
    id: root
    property var backend
    
    property bool loaded: false
    property string statusMessage: ""
    property bool isError: false

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
            statusMessage = "Loaded from backend"
            isError = false
        }
    }

    Connections {
        target: backend
        function onLatestStateChanged() {
            if (!loaded && backend.latestState && backend.latestState.cpuFanTable) {
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
                statusMessage = "Invalid numbers in CPU table"
                isError = true
                return
            }
            if (t < 0 || t > 110) {
                statusMessage = "CPU Temp out of range (0-110)"
                isError = true
                return
            }
            if (s < 0 || s > 100) {
                statusMessage = "CPU Speed out of range (0-100)"
                isError = true
                return
            }
            if (i > 0 && t <= lastTemp) {
                statusMessage = "CPU Temps must be ascending (Row " + (i+1) + ")"
                isError = true
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
                statusMessage = "Invalid numbers in GPU table"
                isError = true
                return
            }
            if (tg < 0 || tg > 110) {
                statusMessage = "GPU Temp out of range (0-110)"
                isError = true
                return
            }
            if (sg < 0 || sg > 100) {
                statusMessage = "GPU Speed out of range (0-100)"
                isError = true
                return
            }
            if (j > 0 && tg <= lastTemp) {
                statusMessage = "GPU Temps must be ascending (Row " + (j+1) + ")"
                isError = true
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
            statusMessage = "Configuration sent!"
            isError = false
        } else {
            statusMessage = "Backend not connected"
            isError = true
        }
    }

    // UI Layout
    RowLayout {
        Layout.fillWidth: true
        spacing: 0
        
        PlasmaComponents.Button {
            text: "CPU Fan Curve"
            checkable: true
            checked: currentTab === 0
            onClicked: currentTab = 0
            Layout.fillWidth: true
        }
        PlasmaComponents.Button {
            text: "GPU Fan Curve"
            checkable: true
            checked: currentTab === 1
            onClicked: currentTab = 1
            Layout.fillWidth: true
        }
    }

    // Header
    RowLayout {
        Layout.fillWidth: true
        Layout.margins: 5
        PlasmaComponents.Label { 
            text: "Temp (°C)" 
            Layout.preferredWidth: 80 
            font.bold: true 
            horizontalAlignment: Text.AlignHCenter 
        }
        PlasmaComponents.Label { 
            text: "Speed (%)" 
            Layout.preferredWidth: 80 
            font.bold: true 
            horizontalAlignment: Text.AlignHCenter 
        }
        Item { Layout.fillWidth: true } // Spacer
    }

    QQC2.ScrollView {
        Layout.fillWidth: true
        Layout.fillHeight: true
        Layout.minimumHeight: 200
        contentWidth: availableWidth
        clip: true

        ColumnLayout {
            width: parent.width
            spacing: 5

            Repeater {
                model: currentTab === 0 ? cpuModel : gpuModel
                delegate: RowLayout {
                    Layout.fillWidth: true
                    spacing: 10
                    
                    PlasmaComponents.TextField {
                        text: temp
                        Layout.preferredWidth: 80
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
                        Layout.preferredWidth: 80
                        horizontalAlignment: Text.AlignHCenter
                        validator: IntValidator { bottom: 0; top: 100 }
                        inputMethodHints: Qt.ImhDigitsOnly
                        onEditingFinished: {
                            var model = currentTab === 0 ? cpuModel : gpuModel
                            model.setProperty(index, "speed", parseInt(text))
                        }
                    }
                    
                    PlasmaComponents.Button {
                        text: "X"
                        Layout.preferredWidth: 40
                        onClicked: removeRow(currentTab === 0, index)
                        PlasmaComponents.ToolTip.text: "Remove Row"
                        PlasmaComponents.ToolTip.visible: hovered
                    }

                    Item { Layout.fillWidth: true }
                }
            }

            PlasmaComponents.Button {
                text: "Add Row"
                icon.name: "list-add"
                Layout.alignment: Qt.AlignHCenter
                onClicked: addRow(currentTab === 0)
            }
        }
    }

    RowLayout {
        Layout.fillWidth: true
        Layout.topMargin: 10
        
        PlasmaComponents.Button {
            text: "Reload"
            icon.name: "view-refresh"
            onClicked: loadFromBackend()
            PlasmaComponents.ToolTip.text: "Reload from Backend"
            PlasmaComponents.ToolTip.visible: hovered
        }
        
        Item { Layout.fillWidth: true }
        
        PlasmaComponents.Button {
            text: "Apply"
            icon.name: "dialog-ok"
            onClicked: validateAndSave()
            PlasmaComponents.ToolTip.text: "Apply Configuration"
            PlasmaComponents.ToolTip.visible: hovered
        }
    }

    PlasmaComponents.Label {
        text: statusMessage
        color: isError ? "red" : "green"
        visible: text !== ""
        Layout.fillWidth: true
        wrapMode: Text.WordWrap
        horizontalAlignment: Text.AlignHCenter
        font.bold: true
    }
}
