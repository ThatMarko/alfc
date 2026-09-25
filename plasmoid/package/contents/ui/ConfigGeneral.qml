pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import org.kde.plasma.plasmoid

Kirigami.FormLayout {
    id: root

    property string title: i18n("General")

    property alias cfg_serverUrl: serverUrlField.text
    property alias cfg_webUiUrl: webUiUrlField.text
    property alias cfg_warningTemp: warningTempSpinBox.value
    property alias cfg_compactShowIcon: compactShowIconCheck.checked

    property string cfg_serverUrlDefault: ""
    property string cfg_webUiUrlDefault: ""
    property int cfg_warningTempDefault: 90
    property bool cfg_compactShowIconDefault: false

    WidgetSettings {
        id: settings
    }

    readonly property string serverUrlDefaultText: settings.defaultServerUrl
    readonly property string trimmedServerUrl: String(serverUrlField.text ?? "").trim()
    readonly property string trimmedWebUiUrl: String(webUiUrlField.text ?? "").trim()
    readonly property bool hasCustomServerUrl: trimmedServerUrl.length > 0
    readonly property bool serverUrlValid: settings.isValidWebSocketUrl(trimmedServerUrl)
    readonly property bool webUiUrlValid: settings.isValidHttpUrl(trimmedWebUiUrl)
    readonly property string derivedWebUiUrl: settings.deriveWebUiUrl(
        hasCustomServerUrl ? trimmedServerUrl : serverUrlDefaultText,
        trimmedWebUiUrl)

    Kirigami.InlineMessage {
        Layout.fillWidth: true
        visible: !root.serverUrlValid || !root.webUiUrlValid
        type: Kirigami.MessageType.Error
        text: !root.serverUrlValid
            ? i18n("Server URL must start with ws:// or wss:// and end with /ws.")
            : i18n("Web interface URL must start with http:// or https://.")
    }

    QQC2.TextField {
        id: serverUrlField

        Kirigami.FormData.label: i18n("Server URL:")
        placeholderText: root.serverUrlDefaultText
        inputMethodHints: Qt.ImhUrlCharactersOnly | Qt.ImhNoPredictiveText
    }

    QQC2.TextField {
        id: webUiUrlField

        Kirigami.FormData.label: i18n("Web interface URL:")
        placeholderText: i18n("Derived automatically")
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

    QQC2.Label {
        Kirigami.FormData.label: i18n("Resolved web interface:")
        text: root.serverUrlValid && root.webUiUrlValid
            ? root.derivedWebUiUrl
            : i18n("Unavailable until the URLs are valid")
        wrapMode: Text.WordWrap
    }
}
