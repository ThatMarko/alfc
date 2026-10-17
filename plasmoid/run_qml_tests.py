#!/usr/bin/env python3
"""Run the widget's Qt runtime tests with PySide6 (development only)."""

import os
import argparse
from pathlib import Path
import sys
import tempfile

from PySide6.QtCore import QObject, Property, Signal, Slot, qFatal
from PySide6.QtNetwork import QHostAddress, QTcpServer
from PySide6.QtQml import QQmlEngine
from PySide6.QtQuickTest import QUICK_TEST_MAIN_WITH_SETUP


class Setup(QObject):
    connectionsChanged = Signal()

    def __init__(self):
        super().__init__()
        self._silent_server = None
        self._silent_connections = 0

    @Property(int, notify=connectionsChanged)
    def connections(self):
        return self._silent_connections

    def _accept_silent_connections(self):
        while self._silent_server.hasPendingConnections():
            socket = self._silent_server.nextPendingConnection()
            socket.setParent(self._silent_server)
            socket.readyRead.connect(lambda connection=socket: connection.readAll())
            socket.disconnected.connect(socket.deleteLater)
            socket.readAll()
            self._silent_connections += 1
            self.connectionsChanged.emit()

    @Slot(QQmlEngine)
    def qmlEngineAvailable(self, engine):
        if self._silent_server is None:
            self._silent_server = QTcpServer(self)
            self._silent_server.newConnection.connect(self._accept_silent_connections)
            if not self._silent_server.listen(QHostAddress.SpecialAddress.LocalHost, 0):
                qFatal("Cannot listen for silent WebSocket handshakes: " + self._silent_server.errorString())
        # Accept the TCP request without sending an HTTP/WebSocket handshake.
        # QObject ownership closes outstanding sockets with the test setup.
        engine.globalObject().setProperty(
            "alfcSilentHandshakeEndpoint", f"ws://127.0.0.1:{self._silent_server.serverPort()}/ws"
        )
        QQmlEngine.setObjectOwnership(self, QQmlEngine.ObjectOwnership.CppOwnership)
        engine.globalObject().setProperty("alfcSilentHandshakeProbe", engine.newQObject(self))
        engine.globalObject().setProperty("alfcTestTier", "qt-only")
        # Plasma supplies i18n in production. The standalone Qt test engine
        # needs the same callable interface for connection error messages.
        engine.globalObject().setProperty(
            "i18n",
            engine.evaluate(
                "(function(message) { for (let i = 1; i < arguments.length; ++i) "
                "message = message.replace('%' + i, String(arguments[i])); return message; })"
            ),
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--tier", choices=["qt-only"], default="qt-only")
    _, qt_arguments = parser.parse_known_args()
    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    # Offscreen selects the window system; software also avoids depending on
    # an OpenGL-capable scene graph on headless CI hosts.
    os.environ.setdefault("QT_QUICK_BACKEND", "software")
    cache = tempfile.TemporaryDirectory(prefix="alfc-widget-tests-")
    os.environ.setdefault("XDG_CACHE_HOME", cache.name)
    sys.exit(
        QUICK_TEST_MAIN_WITH_SETUP(
            "alfc-widget", Setup, argv=[sys.argv[0], *qt_arguments], dir=str(Path(__file__).parent)
        )
    )
