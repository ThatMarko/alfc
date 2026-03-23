pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts
import org.kde.kcmutils as KCM
import org.kde.kirigami as Kirigami

KCM.SimpleKCM {
    id: root

    property alias cfg_serverUrl: serverUrlField.text
    property alias cfg_warningTemp: warningTempSpinBox.value
    property alias cfg_compactShowIcon: compactShowIconCheck.checked
    readonly property string trimmedServerUrl: serverUrlField.text.trim()
    readonly property bool hasCustomServerUrl: trimmedServerUrl.length > 0
    readonly property bool serverUrlValid: !hasCustomServerUrl
        || /^wss?:\/\/.+/.test(trimmedServerUrl)

    header: Kirigami.InlineMessage {
        visible: !root.serverUrlValid
        type: Kirigami.MessageType.Error
        position: Kirigami.InlineMessage.Position.Header
        text: i18n("Server URL must start with ws:// or wss://.")
    }

    Kirigami.FormLayout {
        QQC2.TextField {
            id: serverUrlField

            Kirigami.FormData.label: i18n("Server URL:")
            placeholderText: i18n("ws://localhost:5522/ws")
            inputMethodHints: Qt.ImhUrlCharactersOnly | Qt.ImhNoPredictiveText
        }

        QQC2.SpinBox {
            id: warningTempSpinBox

            Kirigami.FormData.label: i18n("Warning temperature (\u00B0C):")
            from: 50
            to: 110
            stepSize: 5
        }

        QQC2.CheckBox {
            id: compactShowIconCheck

            Kirigami.FormData.label: i18n("Panel display:")
            text: i18n("Show icon instead of text")
        }
    }
}
