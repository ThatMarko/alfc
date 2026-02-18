import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import org.kde.kcmutils as KCM

KCM.SimpleKCM {
    property alias cfg_serverUrl: serverUrlField.text

    Kirigami.FormLayout {
        TextField {
            id: serverUrlField
            Kirigami.FormData.label: i18n("Server URL:")
            placeholderText: "ws://localhost:5522/ws"
        }
    }
}
