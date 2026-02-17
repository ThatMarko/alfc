import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import org.kde.plasma.plasmoid

Kirigami.FormLayout {
    TextField {
        Kirigami.FormData.label: "Server URL:"
        text: Plasmoid.configuration.serverUrl
        onTextChanged: Plasmoid.configuration.serverUrl = text
    }
}
