.pragma library

// Keep these boundary checks in sync with common/protocol.ts and
// common/validation.ts. QML cannot import the shared TypeScript modules.
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isNumber(value) {
    return typeof value === "number" && Number.isFinite(value)
}

function isIntegerInRange(value, minimum, maximum) {
    return isNumber(value) && Number.isInteger(value)
        && value >= minimum && value <= maximum
}

function supportsProtocolVersion(version) {
    return typeof version === "string" && /^1\.\d+$/.test(version)
}

function isFanTable(table) {
    if (!Array.isArray(table) || table.length === 0) {
        return false
    }
    let previousTemp = -1
    for (let index = 0; index < table.length; index += 1) {
        const row = table[index]
        if (!Array.isArray(row) || row.length !== 2
                || !isNumber(row[0]) || row[0] < 0 || row[0] > 110
                || row[0] <= previousTemp
                || !isNumber(row[1]) || row[1] < 0 || row[1] > 100) {
            return false
        }
        previousTemp = row[0]
    }
    return true
}

function isState(state) {
    if (!isRecord(state) || !supportsProtocolVersion(state.protocolVersion)
            || !isFanTable(state.cpuFanTable) || !isFanTable(state.gpuFanTable)
            || typeof state.doFixedSpeed !== "boolean"
            || typeof state.gpuBoost !== "boolean"
            || !isIntegerInRange(state.fixedPercentage, 0, 100)
            || !isIntegerInRange(state.pl1, 0, 200)
            || !isIntegerInRange(state.pl2, 0, 200)) {
        return false
    }
    const flags = ["isFanControlAvailable", "isCpuTuningAvailable", "isGpuBoostAvailable", "restartRequired"]
    return flags.every(function (key) {
        return state[key] === undefined || typeof state[key] === "boolean"
    })
}

function isActivity(activity) {
    return isRecord(activity)
        && isNumber(activity.avgCPUTemp) && isNumber(activity.avgGPUTemp)
        && isNumber(activity.target) && activity.target >= 0 && activity.target <= 100
        && (activity.appliedSpeed === null || (isNumber(activity.appliedSpeed)
            && activity.appliedSpeed >= 0 && activity.appliedSpeed <= 100))
        && (activity.sensorFailure === undefined || typeof activity.sensorFailure === "boolean")
}
