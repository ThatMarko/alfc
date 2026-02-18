import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
Kirigami.FormLayout {
    property alias cfg_serverUrl: serverUrlField.text

    TextField {
        id: serverUrlField
        Kirigami.FormData.label: "Server URL:"
    }
}
