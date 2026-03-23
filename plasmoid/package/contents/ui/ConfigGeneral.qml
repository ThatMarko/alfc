pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts
import org.kde.kcmutils as KCM
import org.kde.kirigami as Kirigami
import "." as ALFC
import "UrlUtils.js" as UrlUtils

KCM.SimpleKCM {
    id: root

    property string serverUrlDraft: ALFC.WidgetSettings.configuredServerUrl
    property int warningTempDraft: ALFC.WidgetSettings.warningTemp
    property bool compactShowIconDraft: ALFC.WidgetSettings.compactShowIcon
    readonly property string serverUrlDefaultText: UrlUtils.defaultServerUrl
    readonly property string trimmedServerUrl: serverUrlDraft.trim()
    readonly property bool hasCustomServerUrl: trimmedServerUrl.length > 0
    readonly property bool serverUrlValid: UrlUtils.isValidWebSocketUrl(
        trimmedServerUrl)
    readonly property string derivedWebUiUrl: UrlUtils.deriveWebUiUrl(
        hasCustomServerUrl ? trimmedServerUrl : serverUrlDefaultText,
        "")
    readonly property bool unsavedChanges: root.serverUrlValid
        && (trimmedServerUrl !== ALFC.WidgetSettings.configuredServerUrl
            || warningTempDraft !== ALFC.WidgetSettings.warningTemp
            || compactShowIconDraft !== ALFC.WidgetSettings.compactShowIcon)

    function saveConfig() {
        if (!root.serverUrlValid) {
            return
        }

        ALFC.WidgetSettings.setConfiguredServerUrl(trimmedServerUrl)
        ALFC.WidgetSettings.setWarningTemp(warningTempDraft)
        ALFC.WidgetSettings.setCompactShowIcon(compactShowIconDraft)
    }

    header: Kirigami.InlineMessage {
        visible: !root.serverUrlValid
        type: Kirigami.MessageType.Error
        position: Kirigami.InlineMessage.Position.Header
        text: i18n("Server URL must start with ws:// or wss://.")
    }

    Kirigami.FormLayout {
        QQC2.TextField {
            id: serverUrlField

            text: root.serverUrlDraft
            Kirigami.FormData.label: i18n("Server URL:")
            placeholderText: root.serverUrlDefaultText
            inputMethodHints: Qt.ImhUrlCharactersOnly | Qt.ImhNoPredictiveText
            onTextChanged: root.serverUrlDraft = text
        }

        QQC2.SpinBox {
            id: warningTempSpinBox

            value: root.warningTempDraft
            Kirigami.FormData.label: i18n("Warning temperature (\u00B0C):")
            from: 50
            to: 110
            stepSize: 5
            onValueModified: root.warningTempDraft = value
        }

        QQC2.CheckBox {
            id: compactShowIconCheck

            checked: root.compactShowIconDraft
            Kirigami.FormData.label: i18n("Panel display:")
            text: i18n("Show icon instead of text")
            onToggled: root.compactShowIconDraft = checked
        }

        QQC2.Label {
            Kirigami.FormData.label: i18n("Web interface:")
            text: root.serverUrlValid
                ? root.derivedWebUiUrl
                : i18n("Unavailable until the server URL is valid")
            wrapMode: Text.WordWrap
        }
    }
}
