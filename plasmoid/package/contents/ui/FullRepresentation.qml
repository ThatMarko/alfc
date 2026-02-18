import QtQuick
import QtQuick.Layouts
import org.kde.plasma.components as PlasmaComponents
import org.kde.plasma.extras as PlasmaExtras
import org.kde.plasma.plasmoid
import org.kde.kirigami as Kirigami

PlasmaExtras.Representation {
    required property var backend

    collapseMarginsHint: true
    Layout.minimumWidth: Kirigami.Units.gridUnit * 22
    Layout.minimumHeight: Kirigami.Units.gridUnit * 24
    Layout.preferredWidth: Layout.minimumWidth
    Layout.preferredHeight: Layout.minimumHeight

    header: PlasmaExtras.PlasmoidHeading {
        RowLayout {
            anchors.fill: parent

            Kirigami.Heading {
                level: 2
                text: i18n("Aorus Laptop Fan Control")
                Layout.fillWidth: true
            }

            PlasmaComponents.ToolButton {
                icon.name: "internet-web-browser"
                PlasmaComponents.ToolTip.text: i18n("Open Web UI")
                PlasmaComponents.ToolTip.delay: Kirigami.Units.toolTipDelay
                PlasmaComponents.ToolTip.visible: hovered
                onClicked: Qt.openUrlExternally("http://localhost:5522")
            }
        }
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: Kirigami.Units.largeSpacing
        spacing: Kirigami.Units.largeSpacing
        visible: backend && backend.isConnected

        PlasmaComponents.Label {
            text: i18n("Connected")
            color: Kirigami.Theme.positiveTextColor
            font.bold: true
            Layout.alignment: Qt.AlignHCenter
        }

        // Activity Section
        GridLayout {
            columns: 2
            columnSpacing: Kirigami.Units.largeSpacing
            rowSpacing: Kirigami.Units.smallSpacing
            Layout.fillWidth: true
            visible: backend && backend.isConnected && backend.latestActivity && backend.latestActivity.avgCPUTemp !== undefined

            PlasmaComponents.Label { text: i18n("CPU Temp:") }
            PlasmaComponents.Label { text: backend && backend.latestActivity && backend.latestActivity.avgCPUTemp !== undefined ? i18n("%1°C", Math.round(backend.latestActivity.avgCPUTemp)) : "--" }

            PlasmaComponents.Label { text: i18n("GPU Temp:") }
            PlasmaComponents.Label { text: backend && backend.latestActivity && backend.latestActivity.avgGPUTemp !== undefined ? i18n("%1°C", Math.round(backend.latestActivity.avgGPUTemp)) : "--" }

            PlasmaComponents.Label { text: i18n("Fan Speed:") }
            PlasmaComponents.Label { text: backend && backend.latestActivity && backend.latestActivity.appliedSpeed != null ? i18n("%1%", Math.round(backend.latestActivity.appliedSpeed)) : "--" }

            PlasmaComponents.Label { text: i18n("Target:") }
            PlasmaComponents.Label { text: backend && backend.latestActivity && backend.latestActivity.target !== undefined ? i18n("%1%", Math.round(backend.latestActivity.target)) : "--" }
        }

        PlasmaComponents.Label {
            visible: backend && backend.isConnected && (!backend.latestActivity || backend.latestActivity.avgCPUTemp === undefined)
            text: i18n("Waiting for activity data…")
            Layout.alignment: Qt.AlignHCenter
            font.italic: true
            color: Kirigami.Theme.disabledTextColor
        }

        // State Section
        GridLayout {
            columns: 2
            columnSpacing: Kirigami.Units.largeSpacing
            rowSpacing: Kirigami.Units.smallSpacing
            Layout.fillWidth: true
            visible: backend && backend.isConnected && backend.latestState && backend.latestState.protocolVersion !== undefined

            PlasmaComponents.Label { text: i18n("Protocol:") }
            PlasmaComponents.Label { text: backend && backend.latestState && backend.latestState.protocolVersion ? backend.latestState.protocolVersion : "--" }

            PlasmaComponents.Label { text: i18n("Mode:") }
            PlasmaComponents.Label { text: backend && backend.latestState && backend.latestState.doFixedSpeed !== undefined ? (backend.latestState.doFixedSpeed ? i18n("Fixed") : i18n("Curve")) : "--" }

            PlasmaComponents.Label { text: i18n("Fixed Speed:") }
            PlasmaComponents.Label { text: backend && backend.latestState && backend.latestState.fixedPercentage !== undefined ? i18n("%1%", backend.latestState.fixedPercentage) : "--" }

            PlasmaComponents.Label { text: i18n("PL1:") }
            PlasmaComponents.Label { text: backend && backend.latestState && backend.latestState.pl1 !== undefined ? i18n("%1 W", backend.latestState.pl1) : "--" }

            PlasmaComponents.Label { text: i18n("PL2:") }
            PlasmaComponents.Label { text: backend && backend.latestState && backend.latestState.pl2 !== undefined ? i18n("%1 W", backend.latestState.pl2) : "--" }

            PlasmaComponents.Label { text: i18n("GPU Boost:") }
            PlasmaComponents.Label { text: backend && backend.latestState && backend.latestState.gpuBoost !== undefined ? (backend.latestState.gpuBoost ? i18n("On") : i18n("Off")) : "--" }
        }

        PlasmaComponents.Label {
            visible: backend && backend.isConnected && (!backend.latestState || backend.latestState.protocolVersion === undefined)
            text: i18n("Waiting for state data…")
            Layout.alignment: Qt.AlignHCenter
            font.italic: true
            color: Kirigami.Theme.disabledTextColor
        }

        // Controls Section
        ColumnLayout {
            Layout.fillWidth: true
            visible: backend && backend.isConnected && backend.latestState
            spacing: Kirigami.Units.largeSpacing

            // Mode Toggle & Fixed Speed
            ColumnLayout {
                Layout.fillWidth: true
                spacing: Kirigami.Units.largeSpacing

                // Mode Toggle
                RowLayout {
                    Layout.alignment: Qt.AlignHCenter
                    spacing: Kirigami.Units.largeSpacing

                    PlasmaComponents.Label {
                        text: i18n("Mode:")
                        font.bold: true
                    }

                    PlasmaComponents.Label { text: i18n("Auto") }

                    PlasmaComponents.Switch {
                        checked: backend && backend.latestState && backend.latestState.doFixedSpeed === true
                        onToggled: {
                            backend.send({
                                kind: "dofixedspeed",
                                methodId: "ui-toggle",
                                methodName: "setMode",
                                data: checked
                            })
                        }
                    }

                    PlasmaComponents.Label { text: i18n("Fixed") }
                }

                // Fixed Speed Control
                ColumnLayout {
                    Layout.fillWidth: true
                    opacity: backend && backend.latestState && backend.latestState.doFixedSpeed === true ? 1.0 : 0.0
                    visible: opacity > 0
                    Behavior on opacity { NumberAnimation { duration: Kirigami.Units.longDuration } }

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Kirigami.Units.largeSpacing

                        PlasmaComponents.Label { text: i18n("Fixed Speed:") }

                        PlasmaComponents.Slider {
                            id: speedSlider
                            Layout.fillWidth: true
                            from: 0
                            to: 100
                            stepSize: 1

                            Binding on value {
                                value: backend && backend.latestState && backend.latestState.fixedPercentage !== undefined ? backend.latestState.fixedPercentage : 0
                                when: !speedSlider.pressed && backend && backend.latestState
                                restoreMode: Binding.RestoreBinding
                            }

                            onPressedChanged: {
                                if (!pressed) {
                                    applySpeed(value)
                                }
                            }
                        }

                        PlasmaComponents.TextField {
                            id: speedField
                            text: Math.round(speedSlider.value).toString()
                            Layout.preferredWidth: Kirigami.Units.gridUnit * 3
                            horizontalAlignment: Text.AlignRight
                            validator: IntValidator { bottom: 0; top: 100 }

                            onAccepted: {
                                var val = parseInt(text)
                                if (!isNaN(val)) {
                                    if (val < 0) val = 0;
                                    if (val > 100) val = 100;
                                    speedSlider.value = val
                                    applySpeed(val)
                                    focus = false
                                }
                            }
                        }

                        PlasmaComponents.Label { text: "%" }
                    }

                    PlasmaComponents.Label {
                        id: statusLabel
                        text: ""
                        font.pointSize: Kirigami.Theme.smallFont.pointSize
                        font.family: Kirigami.Theme.smallFont.family
                        font.italic: true
                        Layout.alignment: Qt.AlignRight
                        visible: text !== ""
                    }

                    Timer {
                        id: statusTimer
                        interval: 2000
                        onTriggered: statusLabel.text = ""
                    }

                    function applySpeed(val) {
                        statusLabel.text = i18n("Applying…")
                        statusLabel.color = Kirigami.Theme.neutralTextColor
                        backend.send({
                            kind: "fixedpercentage",
                            methodId: "ui-fixed-speed",
                            methodName: "setSpeed",
                            data: val
                        })
                    }

                    Connections {
                        target: backend
                        function onMessageReceived(msg) {
                            if (msg.methodId === "ui-fixed-speed") {
                                if (msg.kind === "success" || msg.kind === "state") {
                                    statusLabel.text = i18n("Saved")
                                    statusLabel.color = Kirigami.Theme.positiveTextColor
                                    statusTimer.restart()
                                } else if (msg.kind === "error") {
                                    statusLabel.text = i18n("Error: %1", msg.data || i18n("Unknown"))
                                    statusLabel.color = Kirigami.Theme.negativeTextColor
                                }
                            }
                        }
                    }
                }

                // Fan Curve Editor
                FanTableEditor {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    Layout.minimumHeight: Kirigami.Units.gridUnit * 11
                    visible: backend && backend.latestState && backend.latestState.doFixedSpeed === false
                    backend: backend
                }
            }

            // GPU Boost
            RowLayout {
                visible: backend && backend.latestState && backend.latestState.isGpuBoostAvailable === true
                Layout.fillWidth: true

                PlasmaComponents.Label {
                    text: i18n("GPU Boost:")
                    Layout.fillWidth: true
                }

                PlasmaComponents.Switch {
                    checked: backend && backend.latestState && backend.latestState.gpuBoost === true
                    onToggled: {
                        backend.send({
                            kind: "set",
                            methodId: "ui-toggle-boost",
                            methodName: "SetAIBoostStatus",
                            data: { Data: checked ? 1 : 0 }
                        });
                    }
                }
            }

            // CPU Tuning
            ColumnLayout {
                visible: backend && backend.latestState && backend.latestState.isCpuTuningAvailable === true
                Layout.fillWidth: true
                spacing: Kirigami.Units.smallSpacing

                PlasmaComponents.Label {
                    text: i18n("CPU Tuning (Watts)")
                    font.bold: true
                }

                GridLayout {
                    columns: 2
                    columnSpacing: Kirigami.Units.largeSpacing
                    rowSpacing: Kirigami.Units.smallSpacing
                    Layout.fillWidth: true

                    PlasmaComponents.Label { text: i18n("PL1:") }
                    PlasmaComponents.TextField {
                        id: pl1Field
                        validator: IntValidator { bottom: 0; top: 200 }
                        Layout.fillWidth: true

                        Binding on text {
                            value: backend && backend.latestState && backend.latestState.pl1 !== undefined ? backend.latestState.pl1.toString() : "0"
                            when: !pl1Field.activeFocus
                            restoreMode: Binding.RestoreBinding
                        }
                    }

                    PlasmaComponents.Label { text: i18n("PL2:") }
                    PlasmaComponents.TextField {
                        id: pl2Field
                        validator: IntValidator { bottom: 0; top: 200 }
                        Layout.fillWidth: true

                        Binding on text {
                            value: backend && backend.latestState && backend.latestState.pl2 !== undefined ? backend.latestState.pl2.toString() : "0"
                            when: !pl2Field.activeFocus
                            restoreMode: Binding.RestoreBinding
                        }
                    }
                }

                PlasmaComponents.Button {
                    text: i18n("Apply Limits")
                    Layout.alignment: Qt.AlignRight
                    onClicked: {
                        var p1 = parseInt(pl1Field.text);
                        var p2 = parseInt(pl2Field.text);
                        if (!isNaN(p1) && !isNaN(p2)) {
                            backend.send({
                                kind: "tune",
                                methodId: "ui-tune",
                                methodName: "tune",
                                data: { pl1: p1, pl2: p2 }
                            });
                        }
                    }
                }
            }

            PlasmaComponents.Label {
                visible: backend && backend.latestState && backend.latestState.isCpuTuningAvailable === false
                text: i18n("CPU Tuning unavailable (Intel XTU issue?)")
                font.italic: true
                color: Kirigami.Theme.disabledTextColor
                Layout.alignment: Qt.AlignHCenter
            }
        }

        Item { Layout.fillHeight: true } // Spacer
    }

    PlasmaExtras.PlaceholderMessage {
        visible: !backend || !backend.isConnected
        iconName: "network-disconnect"
        text: backend ? (backend.lastError ? i18n("Disconnected: %1", backend.lastError) : i18n("Disconnected")) : i18n("No Backend")
        width: parent.width - Kirigami.Units.gridUnit * 2
        anchors.centerIn: parent

        helpfulAction: Kirigami.Action {
            icon.name: "configure"
            text: i18n("Configure Server URL")
            onTriggered: Plasmoid.internalAction("configure").trigger()
        }
    }
}
