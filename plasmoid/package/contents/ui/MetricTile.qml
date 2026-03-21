pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Layouts

import org.kde.kirigami as Kirigami
import org.kde.plasma.components as PlasmaComponents

Rectangle {
    id: root

    required property string label
    required property string value
    property string subtitle: ""
    property color valueColor: Kirigami.Theme.textColor

    radius: Kirigami.Units.mediumSpacing
    color: Qt.alpha(Kirigami.Theme.backgroundColor, 0.9)
    border.width: 1
    border.color: Qt.alpha(Kirigami.Theme.textColor, 0.06)

    Layout.fillWidth: true
    Layout.minimumWidth: Kirigami.Units.gridUnit * 7
    implicitHeight: tileLayout.implicitHeight + Kirigami.Units.largeSpacing

    ColumnLayout {
        id: tileLayout
        anchors.fill: parent
        anchors.margins: Kirigami.Units.mediumSpacing
        spacing: Kirigami.Units.smallSpacing

        PlasmaComponents.Label {
            text: root.label
            color: Kirigami.Theme.disabledTextColor
            font: Kirigami.Theme.smallFont
            Layout.fillWidth: true
            wrapMode: Text.WordWrap
        }

        PlasmaComponents.Label {
            text: root.value
            color: root.valueColor
            font.pixelSize: Kirigami.Units.gridUnit * 1.1
            font.bold: true
            Layout.fillWidth: true
            wrapMode: Text.WordWrap
        }

        PlasmaComponents.Label {
            visible: root.subtitle.length > 0
            text: root.subtitle
            color: Kirigami.Theme.disabledTextColor
            font: Kirigami.Theme.smallFont
            Layout.fillWidth: true
            wrapMode: Text.WordWrap
        }
    }
}
