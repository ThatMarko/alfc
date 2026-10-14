import QtQuick
import QtTest
import "./package/contents/ui/Protocol.js" as Protocol

TestCase {
    name: "WidgetProtocol"

    function state() {
        return {
            protocolVersion: "1.1", cpuFanTable: [[0, 0], [65.5, 80.25]],
            gpuFanTable: [[20, 0], [110, 100]], doFixedSpeed: false,
            fixedPercentage: 50, gpuBoost: false, pl1: 37, pl2: 106
        }
    }

    function test_version_data() {
        return [
            { tag: "legacy", version: "1.0", accepted: true },
            { tag: "current", version: "1.1", accepted: true },
            { tag: "future-minor", version: "1.99", accepted: true },
            { tag: "major", version: "2.0", accepted: false },
            { tag: "parseInt-prefix", version: "1garbage", accepted: false },
            { tag: "patch", version: "1.1.0", accepted: false }
        ]
    }

    function test_version(data) {
        compare(Protocol.supportsProtocolVersion(data.version), data.accepted)
    }

    function test_stateBoundary() {
        const value = state()
        verify(Protocol.isState(value))
        value.isFanControlAvailable = false
        verify(Protocol.isState(value))
        value.isFanControlAvailable = "false"
        verify(!Protocol.isState(value))
        value.isFanControlAvailable = undefined
        value.restartRequired = true
        verify(Protocol.isState(value))
        value.restartRequired = "true"
        verify(!Protocol.isState(value))
        value.restartRequired = undefined
        value.fixedPercentage = 50.5
        verify(!Protocol.isState(value))
        value.fixedPercentage = 50
        value.cpuFanTable = [[65, 30], [60, 80]]
        verify(!Protocol.isState(value))
        value.cpuFanTable = [[0, 0], [111, 100]]
        verify(!Protocol.isState(value))
    }

    function test_activityBoundary() {
        const value = { avgCPUTemp: 0, avgGPUTemp: 75.5, appliedSpeed: 0, target: 50 }
        verify(Protocol.isActivity(value))
        value.appliedSpeed = null
        value.sensorFailure = true
        verify(Protocol.isActivity(value))
        value.avgCPUTemp = null
        verify(!Protocol.isActivity(value))
        value.avgCPUTemp = 60
        value.target = 101
        verify(!Protocol.isActivity(value))
    }
}
