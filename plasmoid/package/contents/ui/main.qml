import QtQuick
import org.kde.plasma.plasmoid
import org.kde.kirigami as Kirigami

PlasmoidItem {
    id: root

    preferredRepresentation: Plasmoid.compactRepresentation

    switchWidth: Kirigami.Units.gridUnit * 20
    switchHeight: Kirigami.Units.gridUnit * 20

    toolTipMainText: "Aorus Laptop Fan Control"
    toolTipSubText: {
        if (backendConnection.isConnected) {
            if (backendConnection.latestActivity && Object.keys(backendConnection.latestActivity).length > 0) {
                var cpu = backendConnection.latestActivity.avgCPUTemp;
                var gpu = backendConnection.latestActivity.avgGPUTemp;
                var fan = backendConnection.latestActivity.appliedSpeed;
                if (cpu !== undefined && gpu !== undefined) {
                    return "CPU: " + Math.round(cpu) + "° C | GPU: " + Math.round(gpu) + "° C | Fan: " + (fan !== null && fan !== undefined ? Math.round(fan) : "--") + "%";
                }
            }
            return "Connected — waiting for data";
        }
        return "Disconnected";
    }

    property alias backend: backendConnection

    BackendConnection {
        id: backendConnection
    }

    compactRepresentation: CompactRepresentation {
        backend: backendConnection
    }

    fullRepresentation: FullRepresentation {
        backend: backendConnection
    }
}
