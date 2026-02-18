import QtQuick
import QtQuick.Layouts
import org.kde.plasma.components as PlasmaComponents
import org.kde.plasma.extras as PlasmaExtras
import org.kde.kirigami as Kirigami

PlasmaExtras.Representation {
    property var backend

    collapseMarginsHint: true
    Layout.minimumWidth: Kirigami.Units.gridUnit * 22
    Layout.minimumHeight: Kirigami.Units.gridUnit * 24
    Layout.preferredWidth: Layout.minimumWidth
    Layout.preferredHeight: Layout.minimumHeight

    header: PlasmaExtras.PlasmoidHeading {
        PlasmaExtras.Heading {
            level: 2
            text: "Aorus Laptop Fan Control"
        }
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: Kirigami.Units.largeSpacing
        spacing: Kirigami.Units.largeSpacing

        PlasmaComponents.Label {
            text: backend && backend.isConnected ? "Connected" : "Disconnected"
            color: backend && backend.isConnected ? Kirigami.Theme.positiveTextColor : Kirigami.Theme.negativeTextColor
            font.bold: true
            Layout.alignment: Qt.AlignHCenter
        }

        // Activity Section
        GridLayout {
            columns: 2
            Layout.fillWidth: true
            visible: backend && backend.isConnected && backend.latestActivity && backend.latestActivity.avgCPUTemp !== undefined

            PlasmaComponents.Label { text: "CPU Temp:" }
            PlasmaComponents.Label { text: backend && backend.latestActivity && backend.latestActivity.avgCPUTemp !== undefined ? Math.round(backend.latestActivity.avgCPUTemp) + "°C" : "--" }

            PlasmaComponents.Label { text: "GPU Temp:" }
            PlasmaComponents.Label { text: backend && backend.latestActivity && backend.latestActivity.avgGPUTemp !== undefined ? Math.round(backend.latestActivity.avgGPUTemp) + "°C" : "--" }

            PlasmaComponents.Label { text: "Fan Speed:" }
            PlasmaComponents.Label { text: backend && backend.latestActivity && backend.latestActivity.appliedSpeed !== null ? Math.round(backend.latestActivity.appliedSpeed) + "%" : "--" }

            PlasmaComponents.Label { text: "Target:" }
            PlasmaComponents.Label { text: backend && backend.latestActivity && backend.latestActivity.target !== undefined ? Math.round(backend.latestActivity.target) + "%" : "--" }
        }

        PlasmaComponents.Label {
            visible: backend && backend.isConnected && (!backend.latestActivity || backend.latestActivity.avgCPUTemp === undefined)
            text: "Waiting for activity data..."
            Layout.alignment: Qt.AlignHCenter
            font.italic: true
            color: Kirigami.Theme.disabledTextColor
        }

        // State Section
        GridLayout {
            columns: 2
            Layout.fillWidth: true
            visible: backend && backend.isConnected && backend.latestState && backend.latestState.protocolVersion !== undefined

            PlasmaComponents.Label { text: "Protocol:" }
            PlasmaComponents.Label { text: backend && backend.latestState && backend.latestState.protocolVersion ? backend.latestState.protocolVersion : "--" }

            PlasmaComponents.Label { text: "Mode:" }
            PlasmaComponents.Label { text: backend && backend.latestState && backend.latestState.doFixedSpeed !== undefined ? (backend.latestState.doFixedSpeed ? "Fixed" : "Curve") : "--" }

            PlasmaComponents.Label { text: "Fixed Speed:" }
            PlasmaComponents.Label { text: backend && backend.latestState && backend.latestState.fixedPercentage !== undefined ? backend.latestState.fixedPercentage + "%" : "--" }

            PlasmaComponents.Label { text: "PL1:" }
            PlasmaComponents.Label { text: backend && backend.latestState && backend.latestState.pl1 !== undefined ? backend.latestState.pl1 + " W" : "--" }

            PlasmaComponents.Label { text: "PL2:" }
            PlasmaComponents.Label { text: backend && backend.latestState && backend.latestState.pl2 !== undefined ? backend.latestState.pl2 + " W" : "--" }

            PlasmaComponents.Label { text: "GPU Boost:" }
            PlasmaComponents.Label { text: backend && backend.latestState && backend.latestState.gpuBoost !== undefined ? (backend.latestState.gpuBoost ? "On" : "Off") : "--" }
        }

        PlasmaComponents.Label {
            visible: backend && backend.isConnected && (!backend.latestState || backend.latestState.protocolVersion === undefined)
            text: "Waiting for state data..."
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
                        text: "Mode:" 
                        font.bold: true
                    }
                    
                    PlasmaComponents.Label { text: "Auto" }
                    
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
                    
                    PlasmaComponents.Label { text: "Fixed" }
                }

                // Fixed Speed Control
                ColumnLayout {
                    Layout.fillWidth: true
                    visible: backend && backend.latestState && backend.latestState.doFixedSpeed === true
                    opacity: visible ? 1.0 : 0.0
                    Behavior on opacity { NumberAnimation { duration: 200 } }

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Kirigami.Units.largeSpacing
                        
                        PlasmaComponents.Label { text: "Fixed Speed:" }
                        
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
                        statusLabel.text = "Applying..."
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
                                    statusLabel.text = "Saved"
                                    statusLabel.color = Kirigami.Theme.positiveTextColor
                                    statusTimer.restart()
                                } else if (msg.kind === "error") {
                                    statusLabel.text = "Error: " + (msg.data || "Unknown")
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
                    text: "GPU Boost:" 
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
                    text: "CPU Tuning (Watts)" 
                    font.bold: true
                }

                GridLayout {
                    columns: 2
                    Layout.fillWidth: true

                    PlasmaComponents.Label { text: "PL1:" }
                    PlasmaComponents.TextField {
                        id: pl1Field
                        text: backend && backend.latestState && backend.latestState.pl1 !== undefined ? backend.latestState.pl1.toString() : "0"
                        validator: IntValidator { bottom: 0; top: 200 }
                        Layout.fillWidth: true
                    }

                    PlasmaComponents.Label { text: "PL2:" }
                    PlasmaComponents.TextField {
                        id: pl2Field
                        text: backend && backend.latestState && backend.latestState.pl2 !== undefined ? backend.latestState.pl2.toString() : "0"
                        validator: IntValidator { bottom: 0; top: 200 }
                        Layout.fillWidth: true
                    }
                }

                PlasmaComponents.Button {
                    text: "Apply Limits"
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
                text: "CPU Tuning unavailable (Intel XTU issue?)"
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
        text: backend ? "Disconnected: " + backend.lastError : "No Backend"
        width: parent.width - Kirigami.Units.gridUnit * 2
        anchors.centerIn: parent
    }
}
