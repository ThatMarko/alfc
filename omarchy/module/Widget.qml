pragma ComponentBehavior: Bound

import QtQuick

FocusScope {
    id: root

    // Omarchy v4.0.4 custom-QML-module injection contract.
    property var bar: null
    property string moduleName: "alfc"
    property var settings: ({})
    readonly property bool vertical: bar ? bar.vertical : false
    readonly property string endpoint: settings && typeof settings.serverUrl === "string"
        ? settings.serverUrl : "ws://127.0.0.1:5522/ws"
    readonly property bool supportedEndpoint: /^ws:\/\/(localhost|127\.0\.0\.1|\[::1\]):5522\/ws\/?$/.exec(endpoint)?.[0] === endpoint
    readonly property string webUrl: supportedEndpoint
        ? endpoint.replace(/^ws:/, "http:").replace(/\/ws\/?$/, "/") : "http://127.0.0.1:5522/"
    readonly property var connection: backend
    // Injected only by the headless test harness; production uses Qt's desktop
    // URL opener in this unprivileged session, without invoking a shell.
    property var openUrl: function(url) { return Qt.openUrlExternally(url) }
    readonly property string statusText: {
        switch (backend.status) {
        case "configuration": return qsTr("Check settings")
        case "offline": return qsTr("Offline")
        case "protocol": return qsTr("Protocol error")
        case "restart": return qsTr("Restart required")
        case "unavailable": return qsTr("Unavailable")
        case "stale": return qsTr("Stale")
        case "sensors": return qsTr("Sensor failure")
        case "unconfirmed": return qsTr("Unconfirmed")
        case "online": return Math.round(backend.activity.appliedSpeed) + "%"
        default: return qsTr("Waiting")
        }
    }
    readonly property string tooltipText: {
        let text = qsTr("ALFC: %1").arg(statusText)
        if (backend.status === "online") {
            text += "\n" + qsTr("CPU %1 °C · GPU %2 °C")
                .arg(Math.round(backend.activity.avgCPUTemp)).arg(Math.round(backend.activity.avgGPUTemp))
            text += "\n" + qsTr("Last acknowledged fan command; physical rotation is not measured.")
        } else if (backend.status === "restart") {
            text += "\n" + qsTr("Restart the ALFC service to retry the failed native channel.")
        } else if (backend.status === "stale" || backend.status === "sensors") {
            text += "\n" + qsTr("Current temperatures and fan output cannot be confirmed.")
        } else if (backend.status === "configuration") {
            text += "\n" + qsTr("Use a loopback ALFC WebSocket endpoint on port 5522.")
        }
        return text + "\n" + qsTr("Open ALFC in your browser")
    }

    implicitWidth: vertical ? (bar ? bar.barSize : 28) : label.implicitWidth + 16
    implicitHeight: bar ? bar.barSize : 28
    activeFocusOnTab: true
    Accessible.role: Accessible.Button
    Accessible.name: qsTr("Open ALFC: %1").arg(statusText)
    Accessible.description: tooltipText
    Accessible.onPressAction: root.launch()

    function launch() { root.openUrl(root.webUrl) }

    Backend {
        id: backend
        serverUrl: root.supportedEndpoint ? root.endpoint : ""
    }

    Rectangle {
        anchors.fill: parent
        color: "transparent"
        border.width: root.activeFocus ? 1 : 0
        border.color: root.bar ? root.bar.foreground : "white"
        radius: 3
    }

    Text {
        id: label
        anchors.centerIn: parent
        text: root.vertical ? "A" : "ALFC " + root.statusText
        textFormat: Text.PlainText
        color: root.bar ? root.bar.foreground : "white"
        font.family: root.bar ? root.bar.fontFamily : "monospace"
        font.pixelSize: Math.max(8, Math.min(14, root.implicitHeight - 10))
    }

    MouseArea {
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: root.launch()
        onEntered: if (root.bar) root.bar.showTooltip(root, root.tooltipText)
        onExited: if (root.bar) root.bar.hideTooltip(root)
    }
    onTooltipTextChanged: if (root.bar && hover.hovered) root.bar.showTooltip(root, root.tooltipText)
    HoverHandler { id: hover }
    Keys.onReturnPressed: function(event) { root.launch(); event.accepted = true }
    Keys.onSpacePressed: function(event) { root.launch(); event.accepted = true }
    Component.onDestruction: if (root.bar) root.bar.hideTooltip(root)
}
