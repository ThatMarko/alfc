import QtQuick
import QtQuick.Layouts
import org.kde.plasma.components as PlasmaComponents

Item {
    property var backend

    width: 300
    height: 300

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 10
        spacing: 10

        PlasmaComponents.Label {
            text: "Aorus Laptop Fan Control"
            font.pointSize: 14
            font.bold: true
            Layout.alignment: Qt.AlignHCenter
        }

        PlasmaComponents.Label {
            text: backend && backend.isConnected ? "Connected" : "Disconnected"
            color: backend && backend.isConnected ? "green" : "red"
            font.bold: true
            Layout.alignment: Qt.AlignHCenter
        }

        // Activity Section
        GridLayout {
            columns: 2
            Layout.fillWidth: true
            visible: backend && backend.isConnected && backend.latestActivity && backend.latestActivity.avgCPUTemp !== undefined

            PlasmaComponents.Label { text: "CPU Temp:" }
            PlasmaComponents.Label { text: backend.latestActivity && backend.latestActivity.avgCPUTemp !== undefined ? Math.round(backend.latestActivity.avgCPUTemp) + "°C" : "--" }

            PlasmaComponents.Label { text: "GPU Temp:" }
            PlasmaComponents.Label { text: backend.latestActivity && backend.latestActivity.avgGPUTemp !== undefined ? Math.round(backend.latestActivity.avgGPUTemp) + "°C" : "--" }

            PlasmaComponents.Label { text: "Fan Speed:" }
            PlasmaComponents.Label { text: backend.latestActivity && backend.latestActivity.appliedSpeed !== null ? Math.round(backend.latestActivity.appliedSpeed) + "%" : "--" }

            PlasmaComponents.Label { text: "Target:" }
            PlasmaComponents.Label { text: backend.latestActivity && backend.latestActivity.target !== undefined ? Math.round(backend.latestActivity.target) + "%" : "--" }
        }

        PlasmaComponents.Label {
            visible: backend && backend.isConnected && (!backend.latestActivity || backend.latestActivity.avgCPUTemp === undefined)
            text: "Waiting for activity data..."
            Layout.alignment: Qt.AlignHCenter
            font.italic: true
            opacity: 0.7
        }

        // State Section
        GridLayout {
            columns: 2
            Layout.fillWidth: true
            visible: backend && backend.isConnected && backend.latestState && backend.latestState.protocolVersion !== undefined

            PlasmaComponents.Label { text: "Protocol:" }
            PlasmaComponents.Label { text: backend.latestState && backend.latestState.protocolVersion ? backend.latestState.protocolVersion : "--" }

            PlasmaComponents.Label { text: "Mode:" }
            PlasmaComponents.Label { text: backend.latestState && backend.latestState.doFixedSpeed !== undefined ? (backend.latestState.doFixedSpeed ? "Fixed" : "Curve") : "--" }

            PlasmaComponents.Label { text: "Fixed Speed:" }
            PlasmaComponents.Label { text: backend.latestState && backend.latestState.fixedPercentage !== undefined ? backend.latestState.fixedPercentage + "%" : "--" }

            PlasmaComponents.Label { text: "PL1:" }
            PlasmaComponents.Label { text: backend.latestState && backend.latestState.pl1 !== undefined ? backend.latestState.pl1 + " W" : "--" }

            PlasmaComponents.Label { text: "PL2:" }
            PlasmaComponents.Label { text: backend.latestState && backend.latestState.pl2 !== undefined ? backend.latestState.pl2 + " W" : "--" }

            PlasmaComponents.Label { text: "GPU Boost:" }
            PlasmaComponents.Label { text: backend.latestState && backend.latestState.gpuBoost !== undefined ? (backend.latestState.gpuBoost ? "On" : "Off") : "--" }
        }

        PlasmaComponents.Label {
            visible: backend && backend.isConnected && (!backend.latestState || backend.latestState.protocolVersion === undefined)
            text: "Waiting for state data..."
            Layout.alignment: Qt.AlignHCenter
            font.italic: true
            opacity: 0.7
        }
        
        // Controls Section
        ColumnLayout {
            Layout.fillWidth: true
            visible: backend && backend.isConnected && backend.latestState
            spacing: 10

            // Mode Toggle & Fixed Speed
            ColumnLayout {
                Layout.fillWidth: true
                spacing: 10

                // Mode Toggle
                RowLayout {
                    Layout.alignment: Qt.AlignHCenter
                    spacing: 10

                    PlasmaComponents.Label { 
                        text: "Mode:" 
                        font.bold: true
                    }
                    
                    PlasmaComponents.Label { text: "Auto" }
                    
                    PlasmaComponents.Switch {
                        checked: backend.latestState && backend.latestState.doFixedSpeed === true
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
                    visible: backend.latestState && backend.latestState.doFixedSpeed === true
                    opacity: visible ? 1.0 : 0.0
                    Behavior on opacity { NumberAnimation { duration: 200 } }

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 10
                        
                        PlasmaComponents.Label { text: "Fixed Speed:" }
                        
                        PlasmaComponents.Slider {
                            id: speedSlider
                            Layout.fillWidth: true
                            from: 0
                            to: 100
                            stepSize: 1
                            
                            Binding on value {
                                value: backend.latestState && backend.latestState.fixedPercentage !== undefined ? backend.latestState.fixedPercentage : 0
                                when: !speedSlider.pressed && backend.latestState
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
                            Layout.preferredWidth: 50
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
                        font.pointSize: 8
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
                        statusLabel.color = "orange"
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
                                    statusLabel.color = "green"
                                    statusTimer.restart()
                                } else if (msg.kind === "error") {
                                    statusLabel.text = "Error: " + (msg.data || "Unknown")
                                    statusLabel.color = "red"
                                }
                            }
                        }
                    }
                }

                // Fan Curve Editor
                FanTableEditor {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    Layout.minimumHeight: 200
                    visible: backend.latestState && backend.latestState.doFixedSpeed === false
                    backend: backend
                }
            }

            // GPU Boost
            RowLayout {
                visible: backend.latestState.isGpuBoostAvailable === true
                Layout.fillWidth: true
                
                PlasmaComponents.Label { 
                    text: "GPU Boost:" 
                    Layout.fillWidth: true
                }
                
                PlasmaComponents.Switch {
                    checked: backend.latestState.gpuBoost === true
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
                visible: backend.latestState.isCpuTuningAvailable === true
                Layout.fillWidth: true
                spacing: 5

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
                        text: backend.latestState.pl1 !== undefined ? backend.latestState.pl1.toString() : "0"
                        validator: IntValidator { bottom: 0; top: 200 }
                        Layout.fillWidth: true
                    }

                    PlasmaComponents.Label { text: "PL2:" }
                    PlasmaComponents.TextField {
                        id: pl2Field
                        text: backend.latestState.pl2 !== undefined ? backend.latestState.pl2.toString() : "0"
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
                visible: backend.latestState.isCpuTuningAvailable === false
                text: "CPU Tuning unavailable (Intel XTU issue?)"
                font.italic: true
                opacity: 0.7
                Layout.alignment: Qt.AlignHCenter
            }
        }

        PlasmaComponents.Label {
            visible: !backend || !backend.isConnected
            text: backend ? "Error: " + backend.lastError : "No Backend"
            color: "red"
            wrapMode: Text.WordWrap
            Layout.fillWidth: true
            horizontalAlignment: Text.AlignHCenter
        }

        Item { Layout.fillHeight: true } // Spacer
    }
}
