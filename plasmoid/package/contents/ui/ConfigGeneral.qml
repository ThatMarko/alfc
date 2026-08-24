pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import org.kde.plasma.plasmoid
import "UrlUtils.js" as UrlUtils

Item {
    id: root

    WidgetSettings {
        id: widgetSettings

        settingsId: String(Plasmoid.id)
    }

    property string serverUrlDraft: widgetSettings.configuredServerUrl
    property string webUiUrlDraft: widgetSettings.configuredWebUiUrl
    property int warningTempDraft: widgetSettings.warningTemp
    property bool compactShowIconDraft: widgetSettings.compactShowIcon
    readonly property string serverUrlDefaultText: UrlUtils.defaultServerUrl
    readonly property string trimmedServerUrl: serverUrlDraft.trim()
    readonly property string trimmedWebUiUrl: webUiUrlDraft.trim()
    readonly property bool hasCustomServerUrl: trimmedServerUrl.length > 0
    readonly property bool serverUrlValid: UrlUtils.isValidWebSocketUrl(
        trimmedServerUrl)
    readonly property bool webUiUrlValid: UrlUtils.isValidHttpUrl(
        trimmedWebUiUrl)
    readonly property string derivedWebUiUrl: UrlUtils.deriveWebUiUrl(
        hasCustomServerUrl ? trimmedServerUrl : serverUrlDefaultText,
        trimmedWebUiUrl)
    readonly property bool unsavedChanges: root.serverUrlValid
        && root.webUiUrlValid
        && (trimmedServerUrl !== widgetSettings.configuredServerUrl
            || trimmedWebUiUrl !== widgetSettings.configuredWebUiUrl
            || warningTempDraft !== widgetSettings.warningTemp
            || compactShowIconDraft !== widgetSettings.compactShowIcon)

    width: parent ? parent.width : implicitWidth
    height: parent ? parent.height : implicitHeight
    implicitWidth: contentLayout.implicitWidth
    implicitHeight: contentLayout.implicitHeight

    function saveConfig() {
        if (!root.serverUrlValid || !root.webUiUrlValid) {
            return
        }

        widgetSettings.setConfiguredServerUrl(trimmedServerUrl)
        widgetSettings.setConfiguredWebUiUrl(trimmedWebUiUrl)
        widgetSettings.setWarningTemp(warningTempDraft)
        widgetSettings.setCompactShowIcon(compactShowIconDraft)
    }

    ColumnLayout {
        id: contentLayout

        anchors.fill: parent
        spacing: Kirigami.Units.largeSpacing

        Kirigami.InlineMessage {
            Layout.fillWidth: true
            visible: !root.serverUrlValid || !root.webUiUrlValid
            type: Kirigami.MessageType.Error
            text: !root.serverUrlValid
                ? i18n("Server URL must start with ws:// or wss:// and end with /ws.")
                : i18n("Web interface URL must start with http:// or https://.")
        }

        Kirigami.FormLayout {
            Layout.fillWidth: true

            QQC2.TextField {
                id: serverUrlField

                text: root.serverUrlDraft
                Kirigami.FormData.label: i18n("Server URL:")
                placeholderText: root.serverUrlDefaultText
                inputMethodHints: Qt.ImhUrlCharactersOnly | Qt.ImhNoPredictiveText
                onTextChanged: root.serverUrlDraft = text
            }

            QQC2.TextField {
                id: webUiUrlField

                text: root.webUiUrlDraft
                Kirigami.FormData.label: i18n("Web interface URL:")
                placeholderText: i18n("Derived automatically")
                inputMethodHints: Qt.ImhUrlCharactersOnly | Qt.ImhNoPredictiveText
                onTextChanged: root.webUiUrlDraft = text
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
                Kirigami.FormData.label: i18n("Resolved web interface:")
                text: root.serverUrlValid && root.webUiUrlValid
                    ? root.derivedWebUiUrl
                    : i18n("Unavailable until the URLs are valid")
                wrapMode: Text.WordWrap
            }
        }
    }
}
