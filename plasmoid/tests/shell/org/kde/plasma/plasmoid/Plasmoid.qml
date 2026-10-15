pragma Singleton
import QtQuick
import QtCore

QtObject {
    property QtObject configuration: Settings {
        location: "file://" + alfcSettingsFile
        category: "General"
        property string serverUrl: ""
        property string webUiUrl: ""
        property int warningTemp: 90
        property bool compactShowIcon: false
    }
    property string title: "Aorus Laptop Fan Control"
    property string icon: "preferences-system-power-management"
    property int formFactor: 2
    signal activated()
    signal secondaryActivated()
    function internalAction(name) { return null }
}
