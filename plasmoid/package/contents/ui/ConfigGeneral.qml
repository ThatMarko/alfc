pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts
import org.kde.kcmutils as KCM
import org.kde.kirigami as Kirigami
import "UrlUtils.js" as UrlUtils

KCM.SimpleKCM {
    id: root

    property alias cfg_serverUrl: serverUrlField.text
    property alias cfg_webUiUrl: webUiUrlField.text
    property alias cfg_warningTemp: warningTempSpinBox.value
    property alias cfg_compactShowIcon: compactShowIconCheck.checked
    property string cfg_serverUrlDefault: ""
    property string cfg_webUiUrlDefault: ""
    property int cfg_warningTempDefault: 90
    property bool cfg_compactShowIconDefault: false
    readonly property string serverUrlDefaultText: cfg_serverUrlDefault.length > 0
        ? cfg_serverUrlDefault
        : UrlUtils.defaultServerUrl
    readonly property string trimmedServerUrl: serverUrlField.text.trim()
    readonly property string trimmedWebUiUrl: webUiUrlField.text.trim()
    readonly property bool hasCustomServerUrl: trimmedServerUrl.length > 0
    readonly property bool serverUrlValid: UrlUtils.isValidWebSocketUrl(
        trimmedServerUrl)
    readonly property bool webUiUrlValid: UrlUtils.isValidHttpUrl(
        trimmedWebUiUrl)
    readonly property string derivedWebUiUrl: UrlUtils.deriveWebUiUrl(
        hasCustomServerUrl ? trimmedServerUrl : serverUrlDefaultText,
        trimmedWebUiUrl)

    header: Kirigami.InlineMessage {
        visible: !root.serverUrlValid || !root.webUiUrlValid
        type: Kirigami.MessageType.Error
        position: Kirigami.InlineMessage.Position.Header
        text: !root.serverUrlValid
            ? i18n("Server URL must start with ws:// or wss://.")
            : i18n("Web interface URL must start with http:// or https://.")
    }

    Kirigami.FormLayout {
        QQC2.TextField {
            id: serverUrlField

            Kirigami.FormData.label: i18n("Server URL:")
            placeholderText: root.serverUrlDefaultText
            inputMethodHints: Qt.ImhUrlCharactersOnly | Qt.ImhNoPredictiveText
        }

        QQC2.TextField {
            id: webUiUrlField

            Kirigami.FormData.label: i18n("Web interface URL:")
            placeholderText: root.derivedWebUiUrl.length > 0
                ? root.derivedWebUiUrl
                : i18n("Derived from the server URL")
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
