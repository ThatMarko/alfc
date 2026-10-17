import QtQuick
import "../plasmoid/package/contents/ui" as Widget

Item {
    id: root
    function snapshot() {
        bridge.report(JSON.stringify({event: "snapshot", ready: connection.ready,
            state: connection.latestState, activity: connection.latestActivity,
            fresh: connection.hasFreshActivity, pending: Object.keys(connection.pendingRequests).length,
            error: connection.lastRequestError}))
    }
    Widget.BackendConnection {
        id: connection
        serverUrl: bridge.endpoint
        onReadyChanged: root.snapshot()
        onLatestStateChanged: root.snapshot()
        onLatestActivityChanged: root.snapshot()
        onPendingRequestsChanged: root.snapshot()
        onRequestFinished: function(requestId, ok, errorMessage, message) {
            bridge.report(JSON.stringify({event: "finished", requestId: requestId,
                ok: ok, error: errorMessage, message: message}))
        }
    }
    Connections {
        target: bridge
        function onCommand(line) {
            const command = JSON.parse(line)
            let requestId = ""
            if (command.op === "send") {
                requestId = connection.sendRequest(command.kind, command.data,
                    command.methodName, command.methodId)
            } else if (command.op === "reconnect") {
                connection.reconnect()
            } else if (command.op === "endpoint") {
                connection.serverUrl = command.url
            }
            bridge.report(JSON.stringify({event: "reply", id: command.id, requestId: requestId}))
            root.snapshot()
        }
    }
}
