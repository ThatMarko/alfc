"""Disposable fixtures for the actual installer; never touches a host desktop."""

import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

import manage


class InstallationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="alfc omarchy ' fixture ")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.target = self.root / "config/omarchy/bar/modules/alfc"
        self.source = Path(__file__).resolve().parent

    def test_install_upgrade_remove_preserves_configuration(self):
        config = self.root / "config/omarchy/shell.json"
        config.parent.mkdir(parents=True)
        config.write_text('{"version":1,"custom":"keep this layout"}\n')
        original = config.read_bytes()
        snippet = manage.install(self.target, self.source)
        self.assertEqual(snippet["source"], str(self.target / "Widget.qml"))
        self.assertEqual((self.target / "Protocol.js").read_bytes(),
                         (self.source.parent / "plasmoid/package/contents/ui/Protocol.js").read_bytes())
        for _ in range(3):
            self.assertEqual(manage.install(self.target, self.source), snippet)
        (self.target / "user notes.txt").write_text("unrelated")
        manage.remove(self.target)
        manage.remove(self.target)
        manage.remove(self.root / "never-installed")
        self.assertEqual(config.read_bytes(), original)
        self.assertEqual({entry.name for entry in self.target.iterdir()}, {"user notes.txt", manage.MARKER})
        manage.install(self.target, self.source)
        self.assertEqual((self.target / "user notes.txt").read_text(), "unrelated")

    def test_repeated_remove_is_idempotent(self):
        manage.install(self.target, self.source)
        manage.remove(self.target)
        self.assertFalse(self.target.exists())
        manage.remove(self.target)

    def test_failed_directory_cleanup_retains_ownership_for_reinstallation(self):
        manage.install(self.target, self.source)
        # A read-only parent still permits deleting files from the writable
        # module directory, but prevents removing the directory itself.
        with mock.patch.object(Path, "rmdir", side_effect=PermissionError("read-only parent")):
            manage.remove(self.target)
            manage.remove(self.target)
        self.assertEqual({entry.name for entry in self.target.iterdir()}, {manage.MARKER})
        self.assertEqual((self.target / manage.MARKER).read_text(), manage.IDENTITY)
        manage.install(self.target, self.source)
        manage.remove(self.target)
        self.assertFalse(self.target.exists())

    def test_foreign_directory_is_not_overwritten_or_removed(self):
        self.target.mkdir(parents=True)
        (self.target / "Widget.qml").write_text("foreign")
        with self.assertRaisesRegex(ValueError, "unowned"):
            manage.install(self.target, self.source)
        with self.assertRaisesRegex(ValueError, "unowned"):
            manage.remove(self.target)
        self.assertEqual((self.target / "Widget.qml").read_text(), "foreign")

    def test_foreign_symlinks_are_not_followed(self):
        foreign = self.root / "foreign"
        foreign.mkdir()
        self.target.parent.mkdir(parents=True)
        self.target.symlink_to(foreign, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "symlink"):
            manage.install(self.target, self.source)
        with self.assertRaisesRegex(ValueError, "symlink"):
            manage.remove(self.target)
        self.assertTrue(self.target.is_symlink())
        self.assertEqual(list(foreign.iterdir()), [])

    def test_owned_file_symlink_and_marker_symlink_are_rejected(self):
        for name in (*manage.FILES, manage.MARKER):
            manage.install(self.target, self.source)
            victim = self.root / "victim"
            victim.write_text(manage.IDENTITY)
            (self.target / name).unlink()
            (self.target / name).symlink_to(victim)
            with self.assertRaises(ValueError):
                manage.install(self.target, self.source)
            with self.assertRaises(ValueError):
                manage.remove(self.target)
            self.assertEqual(victim.read_text(), manage.IDENTITY)
            (self.target / name).unlink()
            if name == manage.MARKER:
                (self.target / name).write_text(manage.IDENTITY)

    def test_actual_cli_json_escapes_paths_without_shell_interpolation(self):
        # Includes shell metacharacters, quotes, a newline, and JSON syntax.
        config = self.root / "config $(touch escaped) `touch escaped` \"\n"
        import os
        env = dict(os.environ, XDG_CONFIG_HOME=str(config))
        installed = subprocess.run(["bash", str(self.source / "install.sh")],
                                   env=env, text=True, capture_output=True, check=True)
        snippet = json.loads(installed.stdout.splitlines()[1])
        self.assertEqual(snippet["source"], str(config / "omarchy/bar/modules/alfc/Widget.qml"))
        self.assertFalse((self.root / "escaped").exists())
        subprocess.run(["bash", str(self.source / "uninstall.sh")],
                       env=env, text=True, capture_output=True, check=True)
        self.assertFalse((config / "omarchy/bar/modules/alfc").exists())

    def test_missing_release_dependency_fails_before_modifying_install(self):
        manage.install(self.target, self.source)
        original = (self.target / "Widget.qml").read_bytes()
        with self.assertRaisesRegex(ValueError, "Missing installable resource"):
            manage.install(self.target, self.root / "incomplete-release/omarchy")
        self.assertEqual((self.target / "Widget.qml").read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
