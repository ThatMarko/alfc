// A Plasma shell owns the real WidgetHeading's action objects and applet title.
// Component tests retain the full body with real controls and stub this boundary.
import QtQuick
Item {
    required property string webUiUrl
    implicitHeight: 0
}
