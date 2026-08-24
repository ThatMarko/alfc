pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls as QQC2
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

        if (!Array.isArray(table)) {
            return
        }

        for (let index = 0; index < table.length; index += 1) {
            const entry = table[index]
            if (Array.isArray(entry) && entry.length >= 2) {
                model.append({
                    temp: Math.round(entry[0]),
                    speed: Math.round(entry[1])
                })
            }
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
            table.push([
                parseInt(row.temp, 10),
                parseInt(row.speed, 10)
            ])
        }

        return table
    }

    function activeModel() {
        return root.currentTab === 0 ? cpuModel : gpuModel
    }

    function activeCurveLabel() {
        return root.currentTab === 0 ? i18n("CPU") : i18n("GPU")
    }

    function pointTemperatureAccessibleName(index) {
        return i18n("%1 fan curve point %2 temperature",
            root.activeCurveLabel(),
            index + 1)
    }

    function pointSpeedAccessibleName(index) {
        return i18n("%1 fan curve point %2 speed",
            root.activeCurveLabel(),
            index + 1)
    }

    function pointRemoveAccessibleName(index) {
        return i18n("Remove %1 fan curve point %2",
            root.activeCurveLabel(),
            index + 1)
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
            newTemp = Math.min(110, parseInt(lastItem.temp, 10) + 5)
            newSpeed = Math.min(100, parseInt(lastItem.speed, 10) + 10)
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

    function abortPendingSave() {
        if (root.pendingRequestId.length === 0) {
            return
        }

        root.pendingRequestId = ""
        root.saving = false
        root.setStatus(
            i18n("Connection lost before the fan curves were saved."),
            "error")
    }

    Connections {
        target: root.backend

        function onLatestStateChanged() {
            root.syncFromBackend(false)
        }

        function onIsConnectedChanged() {
            if (root.backend != null && !root.backend.isConnected) {
                root.abortPendingSave()
            }
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

    QQC2.ButtonGroup {
        id: tabButtonGroup
    }

    RowLayout {
        Layout.fillWidth: true
        spacing: 0

        PlasmaComponents.Button {
            text: i18n("CPU")
            checkable: true
            checked: root.currentTab === 0
            QQC2.ButtonGroup.group: tabButtonGroup
            Accessible.name: i18n("CPU fan curve")
            Accessible.description: i18n("Edit the CPU fan curve.")
            onClicked: root.currentTab = 0
            Layout.fillWidth: true
        }

        PlasmaComponents.Button {
            text: i18n("GPU")
            checkable: true
            checked: root.currentTab === 1
            QQC2.ButtonGroup.group: tabButtonGroup
            Accessible.name: i18n("GPU fan curve")
            Accessible.description: i18n("Edit the GPU fan curve.")
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

    Rectangle {
        id: curveGraphContainer

        visible: root.loaded
        Layout.fillWidth: true
        Layout.preferredHeight: Kirigami.Units.gridUnit * 7
        radius: Kirigami.Units.smallSpacing
        color: Qt.alpha(Kirigami.Theme.backgroundColor, 0.6)
        border.width: 1
        border.color: Qt.alpha(Kirigami.Theme.textColor, 0.08)
        clip: true

        readonly property real liveTemp: root.backend != null && root.backend.hasFreshActivity && root.backend.latestActivity != null
            ? Math.round(root.currentTab === 0 ? root.backend.latestActivity.avgCPUTemp : root.backend.latestActivity.avgGPUTemp)
            : -1

        Canvas {
            id: curveCanvas

            anchors.fill: parent
            anchors.margins: Kirigami.Units.smallSpacing

            readonly property var model: root.activeModel()
            readonly property real liveTemperature: curveGraphContainer.liveTemp

            onModelChanged: requestPaint()
            onLiveTemperatureChanged: requestPaint()

            Connections {
                target: root
                function onCurrentTabChanged() { curveCanvas.requestPaint() }
                function onDirtyChanged() { curveCanvas.requestPaint() }
                function onLoadedChanged() { curveCanvas.requestPaint() }
            }

            Connections {
                target: Kirigami.Theme
                function onHighlightColorChanged() { curveCanvas.requestPaint() }
                function onTextColorChanged() { curveCanvas.requestPaint() }
            }

            onPaint: {
                const ctx = getContext("2d")
                ctx.clearRect(0, 0, width, height)

                const paddingLeft = 32
                const paddingRight = 14
                const paddingTop = 12
                const paddingBottom = 20

                const plotWidth = Math.max(10, width - paddingLeft - paddingRight)
                const plotHeight = Math.max(10, height - paddingTop - paddingBottom)

                const minTemp = 20
                const maxTemp = 105
                const minSpeed = 0
                const maxSpeed = 100

                function xForTemp(t) {
                    const clamped = Math.max(minTemp, Math.min(maxTemp, t))
                    return paddingLeft + ((clamped - minTemp) / (maxTemp - minTemp)) * plotWidth
                }

                function yForSpeed(s) {
                    const clamped = Math.max(minSpeed, Math.min(maxSpeed, s))
                    return paddingTop + plotHeight - ((clamped - minSpeed) / (maxSpeed - minSpeed)) * plotHeight
                }

                ctx.strokeStyle = Qt.alpha(Kirigami.Theme.textColor, 0.08)
                ctx.lineWidth = 1
                ctx.fillStyle = Qt.alpha(Kirigami.Theme.disabledTextColor, 0.8)
                ctx.font = "10px sans-serif"
                ctx.textAlign = "right"
                ctx.textBaseline = "middle"

                const speedLevels = [0, 50, 100]
                for (let i = 0; i < speedLevels.length; i++) {
                    const spd = speedLevels[i]
                    const y = yForSpeed(spd)
                    ctx.beginPath()
                    ctx.moveTo(paddingLeft, y)
                    ctx.lineTo(paddingLeft + plotWidth, y)
                    ctx.stroke()
                    ctx.fillText(spd + "%", paddingLeft - 4, y)
                }

                ctx.textAlign = "center"
                ctx.textBaseline = "top"
                const tempMarks = [30, 60, 90]
                for (let i = 0; i < tempMarks.length; i++) {
                    const tmp = tempMarks[i]
                    const x = xForTemp(tmp)
                    ctx.beginPath()
                    ctx.moveTo(x, paddingTop)
                    ctx.lineTo(x, paddingTop + plotHeight)
                    ctx.stroke()
                    ctx.fillText(tmp + "°", x, paddingTop + plotHeight + 4)
                }

                const count = curveCanvas.model ? curveCanvas.model.count : 0
                if (count === 0) return

                const points = []
                for (let i = 0; i < count; i++) {
                    const row = curveCanvas.model.get(i)
                    if (!row) continue
                    const tempVal = parseInt(row.temp, 10)
                    const speedVal = parseInt(row.speed, 10)
                    if (!Number.isNaN(tempVal) && !Number.isNaN(speedVal)) {
                        points.push({
                            temp: tempVal,
                            speed: Math.max(0, Math.min(100, speedVal))
                        })
                    }
                }
                if (points.length === 0) return
                points.sort((a, b) => a.temp - b.temp)

                ctx.beginPath()
                const startX = xForTemp(points[0].temp)
                const startY = yForSpeed(points[0].speed)
                const baselineY = yForSpeed(0)

                ctx.moveTo(startX, baselineY)
                ctx.lineTo(startX, startY)
                for (let i = 1; i < points.length; i++) {
                    ctx.lineTo(xForTemp(points[i].temp), yForSpeed(points[i].speed))
                }
                const lastX = xForTemp(points[points.length - 1].temp)
                ctx.lineTo(lastX, baselineY)
                ctx.closePath()

                const grad = ctx.createLinearGradient(0, paddingTop, 0, paddingTop + plotHeight)
                grad.addColorStop(0, Qt.alpha(Kirigami.Theme.highlightColor, 0.25))
                grad.addColorStop(1, Qt.alpha(Kirigami.Theme.highlightColor, 0.03))
                ctx.fillStyle = grad
                ctx.fill()

                ctx.beginPath()
                ctx.moveTo(startX, startY)
                for (let i = 1; i < points.length; i++) {
                    ctx.lineTo(xForTemp(points[i].temp), yForSpeed(points[i].speed))
                }
                ctx.strokeStyle = Kirigami.Theme.highlightColor
                ctx.lineWidth = 2.5
                ctx.stroke()

                for (let i = 0; i < points.length; i++) {
                    const px = xForTemp(points[i].temp)
                    const py = yForSpeed(points[i].speed)
                    ctx.beginPath()
                    ctx.arc(px, py, 4, 0, Math.PI * 2)
                    ctx.fillStyle = Kirigami.Theme.backgroundColor
                    ctx.fill()
                    ctx.strokeStyle = Kirigami.Theme.highlightColor
                    ctx.lineWidth = 2
                    ctx.stroke()
                }

                if (curveCanvas.liveTemperature >= minTemp && curveCanvas.liveTemperature <= maxTemp) {
                    const tx = xForTemp(curveCanvas.liveTemperature)
                    ctx.beginPath()
                    ctx.setLineDash([3, 3])
                    ctx.moveTo(tx, paddingTop)
                    ctx.lineTo(tx, paddingTop + plotHeight)
                    ctx.strokeStyle = Kirigami.Theme.neutralTextColor
                    ctx.lineWidth = 1.5
                    ctx.stroke()
                    ctx.setLineDash([])

                    ctx.beginPath()
                    ctx.arc(tx, paddingTop + 3, 3, 0, Math.PI * 2)
                    ctx.fillStyle = Kirigami.Theme.neutralTextColor
                    ctx.fill()
                }
            }
        }
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
        QQC2.ScrollBar.horizontal.policy: QQC2.ScrollBar.AlwaysOff

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
                        Accessible.name: root.pointTemperatureAccessibleName(
                            row.index)
                        Accessible.description: i18n("Enter a temperature from 0 to 110 degrees Celsius.")
                        validator: IntValidator {
                            bottom: 0
                            top: 110
                        }
                        onTextEdited: {
                            const value = parseInt(text, 10)
                            if (!Number.isNaN(value)) {
                                root.updateValue(root.activeModel(),
                                    row.index, "temp", value)
                            }
                        }

                        onEditingFinished: {
                            const value = parseInt(text, 10)
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
                        Accessible.name: root.pointSpeedAccessibleName(
                            row.index)
                        Accessible.description: i18n("Enter a fan speed from 0 to 100 percent.")
                        validator: IntValidator {
                            bottom: 0
                            top: 100
                        }
                        inputMethodHints: Qt.ImhDigitsOnly

                        onTextEdited: {
                            const value = parseInt(text, 10)
                            if (!Number.isNaN(value)) {
                                root.updateValue(root.activeModel(),
                                    row.index, "speed", value)
                            }
                        }

                        onEditingFinished: {
                            const value = parseInt(text, 10)
                            if (!Number.isNaN(value)) {
                                root.updateValue(root.activeModel(),
                                    row.index, "speed", value)
                            }
                        }
                    }

                    PlasmaComponents.Button {
                        icon.name: "list-remove"
                        enabled: root.activeModel().count > 1
                        Accessible.name: root.pointRemoveAccessibleName(
                            row.index)
                        Accessible.description: i18n("Remove this point from the active fan curve.")
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
            Accessible.description: i18n("Add a new point to the active fan curve.")
            onClicked: root.addRow()
        }

        PlasmaComponents.Button {
            text: i18n("Reload")
            icon.name: "view-refresh"
            enabled: root.backend != null && root.backend.hasState
            Accessible.description: i18n("Discard unsaved changes and reload the stored fan curves.")
            onClicked: root.syncFromBackend(true)
        }

        Item {
            Layout.fillWidth: true
        }

        PlasmaComponents.Button {
            text: root.saving ? i18n("Saving…") : i18n("Apply Curves")
            icon.name: "dialog-ok"
            enabled: root.loaded && !root.saving
            Accessible.description: i18n("Validate the CPU and GPU fan curves and save them.")
            onClicked: root.validateAndSave()
        }
    }

    InlineStatusMessage {
        messageText: root.statusMessage
        tone: root.statusTone
    }
}
