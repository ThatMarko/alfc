pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Layouts

import org.kde.kirigami as Kirigami
import org.kde.plasma.components as PlasmaComponents

Rectangle {
    id: root

    required property string title
    property string subtitle: ""
    default property alias content: contentLayout.data

    radius: Kirigami.Units.largeSpacing
    color: Qt.alpha(Kirigami.Theme.alternateBackgroundColor, 0.95)
    border.width: 1
    border.color: Qt.alpha(Kirigami.Theme.textColor, 0.08)

    Layout.fillWidth: true
    implicitHeight: cardLayout.implicitHeight + Kirigami.Units.largeSpacing * 2

    ColumnLayout {
        id: cardLayout
        anchors.fill: parent
        anchors.margins: Kirigami.Units.largeSpacing
        spacing: Kirigami.Units.largeSpacing

        ColumnLayout {
            Layout.fillWidth: true
            spacing: Kirigami.Units.smallSpacing

            PlasmaComponents.Label {
                text: root.title
                font.bold: true
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
            }

            PlasmaComponents.Label {
                visible: root.subtitle.length > 0
                text: root.subtitle
                color: Kirigami.Theme.disabledTextColor
                font: Kirigami.Theme.smallFont
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
        }

        ColumnLayout {
            id: contentLayout
            Layout.fillWidth: true
            spacing: Kirigami.Units.largeSpacing
        }
    }
}
