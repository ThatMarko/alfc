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
    if (typeof version !== "string") {
        return false
    }
    // Leading-zero minors ("1.01") are not a distinct version.
    const match = /^1\.([1-9]\d*)$/.exec(version)
    return match !== null && match[0] === version && Number(match[1]) >= 1
}

function isFanTable(table) {
    if (!Array.isArray(table) || table.length === 0 || table.length > 16) {
        return false
    }
    let previousTemp = -1
    let previousSpeed = -1
    for (let index = 0; index < table.length; index += 1) {
        const row = table[index]
        if (!Array.isArray(row) || row.length !== 2
                || !isNumber(row[0]) || row[0] < 0 || row[0] > 110
                || row[0] <= previousTemp
                || !isNumber(row[1]) || row[1] < 0 || row[1] > 100
                || row[1] < previousSpeed) {
            return false
        }
        previousTemp = row[0]
        previousSpeed = row[1]
    }
    // The last entry is the fastest the curve can ever command: it must
    // reach at least 85% fan speed by 90°C.
    const last = table[table.length - 1]
    return last[0] <= 90 && last[1] >= 85
}

function isPowerLimits(pl1, pl2) {
    return isIntegerInRange(pl1, 15, 115)
        && isIntegerInRange(pl2, 15, 150)
        && pl2 >= pl1
}

function isState(state) {
    if (!isRecord(state) || !supportsProtocolVersion(state.protocolVersion)
            || !isFanTable(state.cpuFanTable) || !isFanTable(state.gpuFanTable)
            || typeof state.doFixedSpeed !== "boolean"
            || typeof state.gpuBoost !== "boolean"
            || !isIntegerInRange(state.fixedPercentage, 0, 100)
            || !isPowerLimits(state.pl1, state.pl2)) {
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
