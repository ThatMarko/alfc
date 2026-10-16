#!/usr/bin/env python3
"""Run installer fixtures and staged real Qt WebSocket/module lifecycle tests."""

import argparse
from contextlib import contextmanager
import os
from pathlib import Path
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
import unittest

import manage


@contextmanager
def silent_handshake_endpoint():
    """Accept real TCP connections but deliberately never complete WebSocket."""
    release = threading.Event()

    class SilentPeer(socketserver.BaseRequestHandler):
        def handle(self):
            release.wait()

    # All sockets and worker threads belong to this disposable test context.
    # server_close waits for handlers after release, including failed Qt runs.
    with socketserver.ThreadingTCPServer(("127.0.0.1", 0), SilentPeer) as server:
        thread = threading.Thread(
            target=server.serve_forever, kwargs={"poll_interval": 0.05}
        )
        thread.start()
        try:
            yield f"ws://127.0.0.1:{server.server_address[1]}/ws"
        finally:
            release.set()
            server.shutdown()
            thread.join()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--qml-runner", help="Matching distribution Qt 6 qmltestrunner executable")
    parser.add_argument("--qt-python", help="Python with PySide6 for the explicitly Qt-only tier")
    args = parser.parse_args()
    source = Path(__file__).resolve().parent
    suite = unittest.defaultTestLoader.discover(str(source), pattern="test_*.py")
    if not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful():
        return 1
    if args.qt_python:
        command = [args.qt_python, str(source.parent / "plasmoid/run_qml_tests.py"), "--tier", "qt-only"]
    else:
        runner = args.qml_runner or os.environ.get("QMLTESTRUNNER")
        if not runner:
            for candidate in ("/usr/lib/qt6/bin/qmltestrunner", "qmltestrunner6", "qmltestrunner"):
                if shutil.which(candidate):
                    runner = candidate
                    break
        if not runner:
            parser.error("Qt 6 qmltestrunner is required; use --qml-runner or --qt-python. Tests are not skipped.")
        command = [runner]
    env = dict(os.environ)
    env.setdefault("QT_QPA_PLATFORM", "offscreen")
    env.setdefault("QT_QUICK_BACKEND", "software")
    with (tempfile.TemporaryDirectory(prefix="alfc-omarchy-tests-") as work,
          silent_handshake_endpoint() as silent_endpoint):
        staged = Path(work)
        # Test the same copied resources that installation and release staging
        # consume, including the canonical existing QML protocol guards.
        manage.install(staged / "module", source)
        (staged / "tst_Status.qml").write_text(
            (source / "tst_Status.qml").read_text().replace(
                "@ALFC_SILENT_HANDSHAKE_ENDPOINT@", silent_endpoint
            )
        )
        env["XDG_CACHE_HOME"] = str(staged / "cache")
        return subprocess.run([*command, "-input", str(staged)], env=env, check=False).returncode


if __name__ == "__main__":
    sys.exit(main())
