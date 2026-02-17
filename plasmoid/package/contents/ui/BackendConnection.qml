import QtQuick
import QtWebSockets
import org.kde.plasma.plasmoid

Item {
    id: root

    property string url: Plasmoid.configuration.serverUrl
    property bool isConnected: socket.status === WebSocket.Open
    property bool isConnecting: socket.status === WebSocket.Connecting
    property string lastError: ""
    property var latestState: ({})
    property var latestActivity: ({})

    // Signal for other components to react to messages if needed
    signal messageReceived(var message)

    function send(obj) {
        if (socket.status === WebSocket.Open) {
            socket.sendTextMessage(JSON.stringify(obj));
        } else {
            console.warn("BackendConnection: Cannot send, socket not open");
        }
    }

    WebSocket {
        id: socket
        url: root.url
        active: true

        onStatusChanged: {
            if (socket.status === WebSocket.Open) {
                console.info("BackendConnection: Connected");
                root.lastError = "";
                reconnectTimer.stop();
                reconnectTimer.interval = 1000;
                
                // Register for activity updates
                socket.sendTextMessage(JSON.stringify({
                    kind: "registeractivitysocket",
                    methodId: "register-activity",
                    methodName: "RegisterActivitySocket"
                }));

                // Start keepalive
                keepaliveTimer.start();
            } else if (socket.status === WebSocket.Closed) {
                console.info("BackendConnection: Closed");
                keepaliveTimer.stop();
                reconnectTimer.start();
            } else if (socket.status === WebSocket.Error) {
                console.error("BackendConnection: Error: " + socket.errorString);
                root.lastError = socket.errorString;
                keepaliveTimer.stop();
                reconnectTimer.start();
            }
        }

        onTextMessageReceived: (message) => {
            if (message === "pong") {
                return;
            }

            try {
                var data = JSON.parse(message);
                root.messageReceived(data);

                if (data.kind === "state") {
                    root.latestState = data.data;
                } else if (data.kind === "fancontrolactivity") {
                    root.latestActivity = data.data;
                }
            } catch (e) {
                console.error("BackendConnection: Failed to parse message: " + e);
            }
        }
    }

    Timer {
        id: reconnectTimer
        interval: 1000
        repeat: false
        onTriggered: {
            console.info("BackendConnection: Attempting reconnect...");
            interval = Math.min(interval * 2, 5000);
            socket.active = false;
            socket.active = true;
        }
    }

    Timer {
        id: keepaliveTimer
        interval: 5000 // Send ping every 5 seconds
        repeat: true
        onTriggered: {
            if (socket.status === WebSocket.Open) {
                socket.sendTextMessage("ping");
            }
        }
    }
}
