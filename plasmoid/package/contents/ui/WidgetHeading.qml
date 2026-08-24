pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Layouts
import QtQuick.Templates as T

import org.kde.kirigami as Kirigami
import org.kde.plasma.components as PlasmaComponents
import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.extras as PlasmaExtras
import org.kde.plasma.plasmoid

PlasmaExtras.PlasmoidHeading {
    id: headingRoot

    required property string webUiUrl

    visible: !(Plasmoid.containmentDisplayHints
        & PlasmaCore.Types.ContainmentDrawsPlasmoidHeading)

    contentItem: RowLayout {
        Kirigami.Heading {
            elide: Text.ElideRight
            wrapMode: Text.NoWrap
            Layout.fillWidth: true
            level: 1
            text: Plasmoid.title
        }

        PlasmaComponents.ToolButton {
            Accessible.name: i18n("Open web interface")
            icon.name: "internet-web-browser"
            enabled: headingRoot.webUiUrl.length > 0
            onClicked: Qt.openUrlExternally(headingRoot.webUiUrl)
            PlasmaComponents.ToolTip {
                text: i18n("Open the web interface")
            }
        }

        PlasmaComponents.ToolButton {
            id: actionsButton

            visible: visibleActions > 0
            checked: configMenu.status !== PlasmaExtras.Menu.Closed
            property int visibleActions: menuItemFactory.count
            function resolveSingleAction() {
                if (visibleActions !== 1) {
                    return null
                }

                const menuItem = menuItemFactory.objectAt(0)
                return menuItem ? menuItem.action : null
            }
            property QtObject singleAction: resolveSingleAction()
            icon.name: "open-menu-symbolic"
            checkable: visibleActions > 1
            contentItem.opacity: visibleActions > 1
            Accessible.name: singleAction
                ? singleAction.text
                : i18nd("libplasma6", "More actions")

            Kirigami.Icon {
                parent: actionsButton
                anchors.centerIn: parent
                active: actionsButton.hovered
                implicitWidth: Kirigami.Units.iconSizes.smallMedium
                implicitHeight: implicitWidth
                source: actionsButton.singleAction !== null
                    ? actionsButton.singleAction.icon
                    : ""
                visible: actionsButton.singleAction
            }

            onToggled: {
                if (checked) {
                    configMenu.openRelative()
                } else {
                    configMenu.close()
                }
            }

            onClicked: {
                if (singleAction) {
                    singleAction.trigger()
                }
            }

            PlasmaComponents.ToolTip {
                text: actionsButton.singleAction
                    ? actionsButton.singleAction.text
                    : i18nd("libplasma6", "More actions")
            }

            PlasmaExtras.Menu {
                id: configMenu

                visualParent: actionsButton
                placement: PlasmaExtras.Menu.BottomPosedLeftAlignedPopup
            }

            Instantiator {
                id: menuItemFactory

                model: {
                    const configureAction = Plasmoid.internalAction("configure")
                    return Plasmoid.contextualActions
                        .filter(action => action !== configureAction)
                }

                delegate: PlasmaExtras.MenuItem {
                    required property QtObject modelData

                    action: modelData
                }

                onObjectAdded: (_index, object) => {
                    configMenu.addMenuItem(object)
                }

                onObjectRemoved: (_index, object) => {
                    configMenu.removeMenuItem(object)
                }
            }
        }

        PlasmaComponents.ToolButton {
            id: configureButton

            property PlasmaCore.Action internalAction

            function fetchInternalAction() {
                internalAction = Plasmoid.internalAction("configure")
            }

            Connections {
                target: Plasmoid

                function onInternalActionsChanged() {
                    configureButton.fetchInternalAction()
                }
            }

            Component.onCompleted: fetchInternalAction()

            icon.name: "configure"
            visible: internalAction !== null
            text: internalAction?.text ?? ""
            display: T.AbstractButton.IconOnly
            Accessible.name: text

            PlasmaComponents.ToolTip {
                text: configureButton.text
            }

            onClicked: internalAction?.trigger()
        }
    }
}
