#!/usr/bin/env python3
"""Drive the installed widget transport over real sockets; no Plasma shell stub."""
import json
import os
from pathlib import Path
import sys

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ.setdefault("QT_QUICK_BACKEND", "software")

from PySide6.QtCore import QObject, Property, Signal, Slot, QSocketNotifier, QUrl
from PySide6.QtGui import QGuiApplication
from PySide6.QtQml import QQmlApplicationEngine


class Bridge(QObject):
    command = Signal(str)

    @Property(str, constant=True)
    def endpoint(self):
        return sys.argv[1]

    @Slot(str)
    def report(self, line):
        # Validate the bridge envelope too, so a QML serialization failure
        # produces diagnostics instead of a parent-side timeout.
        print(json.dumps(json.loads(line)), flush=True)


app = QGuiApplication(sys.argv)
engine = QQmlApplicationEngine()
bridge = Bridge()
engine.rootContext().setContextProperty("bridge", bridge)
engine.globalObject().setProperty(
    "i18n", engine.evaluate(
        "(function(message) { for (let i = 1; i < arguments.length; ++i) "
        "message = message.replace('%' + i, String(arguments[i])); return message; })"
    )
)
engine.load(QUrl.fromLocalFile(str(Path(__file__).with_name("qt-client.qml"))))
if not engine.rootObjects():
    sys.exit("The real widget BackendConnection component failed to load")


class StdinCommands(QObject):
    """Keep command delivery, EOF and QML destruction on Qt's owning thread."""

    def __init__(self):
        super().__init__(app)
        self.pending = bytearray()
        self.descriptor = sys.stdin.fileno()
        os.set_blocking(self.descriptor, False)
        self.notifier = QSocketNotifier(
            self.descriptor, QSocketNotifier.Type.Read, self
        )
        self.notifier.activated.connect(self.read_ready)

    @Slot()
    def read_ready(self):
        try:
            chunk = os.read(self.descriptor, 65536)
        except BlockingIOError:
            return
        if not chunk:
            self.notifier.setEnabled(False)
            # Destroy QML sockets and reconnect timers while their owning
            # event loop is still running. Quitting from the former stdin
            # daemon could race a remote-close callback during teardown.
            engine.deleteLater()
            return
        self.pending.extend(chunk)
        while b"\n" in self.pending:
            line, _, remaining = self.pending.partition(b"\n")
            self.pending = bytearray(remaining)
            bridge.command.emit(line.decode("utf-8"))


engine.destroyed.connect(app.quit)
commands = StdinCommands()
sys.exit(app.exec())
