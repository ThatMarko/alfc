import QtQuick
import QtQuick.Layouts
import org.kde.plasma.components as PlasmaComponents
import org.kde.plasma.plasmoid

Item {
    property var backend

    Plasmoid.icon: backend && backend.isConnected ? "computer-laptop" : "network-disconnect"

    RowLayout {
        anchors.fill: parent
        spacing: 4

        PlasmaComponents.Label {
            Layout.fillWidth: true
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
            text: {
                if (!backend || !backend.isConnected) {
                    return "ALFC: Disconnected";
                }
                if (!backend.latestActivity || Object.keys(backend.latestActivity).length === 0) {
                    return "ALFC: No Data";
                }
                
                var cpu = backend.latestActivity.avgCPUTemp;
                var gpu = backend.latestActivity.avgGPUTemp;
                var fan = backend.latestActivity.appliedSpeed;
                
                if (cpu === undefined || gpu === undefined) {
                     return "ALFC: Waiting...";
                }

                return Math.round(cpu) + "°C / " + Math.round(gpu) + "°C | " + (fan !== null ? Math.round(fan) : "--") + "%";
            }
        }
    }
}
