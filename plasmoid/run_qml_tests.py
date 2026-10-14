#!/usr/bin/env python3
"""Run the widget's Qt runtime tests with PySide6 (development only)."""

import os
from pathlib import Path
import sys
import tempfile

from PySide6.QtCore import QObject, Slot
from PySide6.QtQml import QQmlEngine
from PySide6.QtQuickTest import QUICK_TEST_MAIN_WITH_SETUP


class Setup(QObject):
    @Slot(QQmlEngine)
    def qmlEngineAvailable(self, engine):
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
    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    # Offscreen selects the window system; software also avoids depending on
    # an OpenGL-capable scene graph on headless CI hosts.
    os.environ.setdefault("QT_QUICK_BACKEND", "software")
    cache = tempfile.TemporaryDirectory(prefix="alfc-widget-tests-")
    os.environ.setdefault("XDG_CACHE_HOME", cache.name)
    sys.exit(
        QUICK_TEST_MAIN_WITH_SETUP(
            "alfc-widget", Setup, argv=sys.argv, dir=str(Path(__file__).parent)
        )
    )
