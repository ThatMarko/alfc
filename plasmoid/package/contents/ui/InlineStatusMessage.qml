pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Layouts

import org.kde.kirigami as Kirigami

Kirigami.InlineMessage {
    id: root

    property string messageText: ""
    property string tone: ""

    Layout.fillWidth: true
    visible: messageText.length > 0
    showCloseButton: false
    text: messageText
    type: tone === "error"
        ? Kirigami.MessageType.Error
        : (tone === "success"
            ? Kirigami.MessageType.Positive
            : (tone === "warning" || tone === "neutral"
                ? Kirigami.MessageType.Warning
                : Kirigami.MessageType.Information))
}
