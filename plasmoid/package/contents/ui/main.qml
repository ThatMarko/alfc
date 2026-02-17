import QtQuick
import org.kde.plasma.plasmoid

PlasmoidItem {
    id: root

    preferredRepresentation: Plasmoid.compactRepresentation

    property alias backend: backendConnection

    BackendConnection {
        id: backendConnection
    }

    compactRepresentation: CompactRepresentation {
        backend: backendConnection
    }

    fullRepresentation: FullRepresentation {
        backend: backendConnection
    }
}
