import QtQuick
import QtTest
import "./package/contents/ui/Protocol.js" as Protocol

TestCase {
    name: "WidgetProtocol"

    function state() {
        return {
            protocolVersion: "1.1", cpuFanTable: [[0, 0], [65.5, 85.25]],
            gpuFanTable: [[20, 0], [88.5, 100]], doFixedSpeed: false,
            fixedPercentage: 50, gpuBoost: false, pl1: 37, pl2: 106
        }
    }

    function test_version_data() {
        return [
            { tag: "legacy", version: "1.0", accepted: false },
            { tag: "legacy-zeroes", version: "1.00", accepted: false },
            { tag: "leading-zero", version: "1.01", accepted: false },
            { tag: "current", version: "1.1", accepted: true },
            { tag: "future-minor", version: "1.99", accepted: true },
            { tag: "major", version: "2.0", accepted: false },
            { tag: "parseInt-prefix", version: "1garbage", accepted: false },
            { tag: "patch", version: "1.1.0", accepted: false },
            { tag: "newline", version: "1.1\n", accepted: false }
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

    function test_fanTableBoundary() {
        verify(Protocol.isFanTable([[40, 15], [90, 85]]))
        verify(!Protocol.isFanTable([[40, 15], [90, 84.9]]))
        verify(!Protocol.isFanTable([[40, 15], [90.1, 100]]))
        verify(!Protocol.isFanTable([[40, 50], [60, 30]]))
        const sixteen = []
        for (let index = 0; index < 16; index += 1)
            sixteen.push([index * 6, Math.min(100, index * 7)])
        verify(Protocol.isFanTable(sixteen))
        const seventeen = []
        for (let index = 0; index < 17; index += 1)
            seventeen.push([index * 5, Math.min(100, index * 6)])
        verify(!Protocol.isFanTable(seventeen))
    }

    function test_powerLimitsBoundary() {
        const value = state()
        value.pl1 = 15
        value.pl2 = 15
        verify(Protocol.isState(value))
        value.pl1 = 115
        value.pl2 = 150
        verify(Protocol.isState(value))
        value.pl1 = 14
        value.pl2 = 106
        verify(!Protocol.isState(value))
        value.pl1 = 116
        value.pl2 = 120
        verify(!Protocol.isState(value))
        value.pl1 = 37
        value.pl2 = 151
        verify(!Protocol.isState(value))
        value.pl1 = 80
        value.pl2 = 70
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
