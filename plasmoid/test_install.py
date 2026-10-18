"""Run the shipped desktop-user scripts against a disposable package adapter."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class InstallationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="alfc plasma ' fixture ")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'release $(touch escaped) " /plasmoid'
        self.source.mkdir(parents=True)
        original = Path(__file__).resolve().parent
        for name in ("install.sh", "uninstall.sh"):
            shutil.copyfile(original / name, self.source / name)
        shutil.copytree(original / "package", self.source / "package")
        self.bin = self.root / "bin"
        self.bin.mkdir()
        adapter = self.bin / "kpackagetool6"
        adapter.write_text("""#!/usr/bin/env python3
import json
import os
from pathlib import Path
import shutil
import sys

args = sys.argv[1:]
with Path(os.environ['ALFC_PACKAGE_LOG']).open('a') as log:
    log.write(json.dumps(args) + '\\n')
failure_operation = os.environ.get('ALFC_PACKAGE_FAILURE_OPERATION')
if os.environ.get('ALFC_PACKAGE_FAILURE') and (not failure_operation or failure_operation in args):
    sys.exit(int(os.environ['ALFC_PACKAGE_FAILURE']))
if '--show' in args:
    # System packages are visible to --show even without a user installation.
    sys.exit(0 if Path(os.environ['ALFC_SYSTEM_PACKAGE']).exists() else 3)
root = Path(args[args.index('--packageroot') + 1])
target = root / 'org.kde.alfc'
if '--remove' in args:
    # KPackage resolves the removal directory from metadata rather than the
    # command's original ID. Model that behavior to detect neighbor deletion.
    plugin_id = json.loads((target / 'metadata.json').read_text())['KPlugin']['Id']
    shutil.rmtree(root / plugin_id)
else:
    operation = '--upgrade' if '--upgrade' in args else '--install'
    source = Path(args[args.index(operation) + 1])
    if operation == '--upgrade':
        plugin_id = json.loads((target / 'metadata.json').read_text())['KPlugin']['Id']
        shutil.rmtree(root / plugin_id)
    if not (source / 'contents/ui/main.qml').is_file():
        sys.exit(4)
    shutil.copytree(source, target)
""")
        adapter.chmod(0o755)
        self.data = self.root / "user data"
        self.target = self.data / "plasma/plasmoids/org.kde.alfc"
        self.system = self.root / "system/plasma/plasmoids/org.kde.alfc"
        self.log = self.root / "commands.jsonl"
        self.scratch = self.root / "temporary packages"
        self.scratch.mkdir()
        self.env = dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ["PATH"],
                        HOME=str(self.root / "home"), XDG_DATA_HOME=str(self.data),
                        ALFC_PACKAGE_LOG=str(self.log), ALFC_SYSTEM_PACKAGE=str(self.system),
                        TMPDIR=str(self.scratch))

    def run_script(self, name, expected=0):
        result = subprocess.run(["bash", str(self.source / name)], cwd=self.root,
                                env=self.env, text=True, capture_output=True)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result

    def commands(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def test_global_package_does_not_select_user_upgrade_or_removal(self):
        self.system.mkdir(parents=True)
        (self.system / "keep").write_text("distribution managed")
        absent = self.run_script("uninstall.sh")
        self.assertIn("not installed for this user", absent.stdout)
        self.assertEqual(self.commands(), [])
        self.run_script("install.sh")
        self.assertEqual(self.commands()[-1], ["--type", "Plasma/Applet", "--packageroot",
                                            str(self.target.parent), "--install", str(self.source / "package")])
        self.assertEqual((self.system / "keep").read_text(), "distribution managed")

    def test_install_upgrade_remove_and_repeat_preserve_desktop_configuration(self):
        settings = Path(self.env["HOME"]) / ".config/plasma-org.kde.plasma.desktop-appletsrc"
        settings.parent.mkdir(parents=True)
        settings.write_text("[Configuration]\nServerUrl=ws://localhost:5522/ws\n")
        original = settings.read_bytes()
        self.run_script("install.sh")
        (self.target / "contents/ui/main.qml").write_text("old version")
        self.run_script("install.sh")
        self.assertEqual((self.target / "contents/ui/main.qml").read_bytes(),
                         (self.source / "package/contents/ui/main.qml").read_bytes())
        self.assertIn("--upgrade", self.commands()[-1])
        self.assertEqual(list(self.scratch.iterdir()), [])
        self.run_script("uninstall.sh")
        self.assertFalse(self.target.exists())
        count = len(self.commands())
        self.run_script("uninstall.sh")
        self.assertEqual(len(self.commands()), count)
        self.assertEqual(settings.read_bytes(), original)
        self.assertFalse((self.root / "escaped").exists())

    def test_removal_failure_is_not_reported_absent_or_successful(self):
        shutil.copytree(self.source / "package", self.target)
        self.env["ALFC_PACKAGE_FAILURE"] = "23"
        result = self.run_script("uninstall.sh", expected=23)
        self.assertNotIn("not installed", result.stdout)
        self.assertNotIn("Plasmoid removed", result.stdout)
        self.assertIn("--remove", self.commands()[-1])
        self.assertTrue((self.target / "metadata.json").exists())

    def test_invalid_and_foreign_metadata_do_not_mutate_other_applets(self):
        shutil.copytree(self.source / "package", self.target)
        neighbor = self.target.parent / "org.example.foreign"
        neighbor.mkdir()
        (neighbor / "keep").write_text("unrelated applet")
        metadata = self.target / "metadata.json"
        for contents in ("broken metadata", "[]", '{"KPlugin":null}',
                         '{"KPlugin":{"Id":"org.example.foreign"}}'):
            metadata.write_text(contents)
            for script in ("install.sh", "uninstall.sh"):
                result = self.run_script(script, expected=1)
                self.assertIn("refusing package metadata", result.stderr)
                self.assertNotIn("not installed for this user", result.stdout)
            self.assertEqual(metadata.read_text(), contents)
            self.assertEqual((neighbor / "keep").read_text(), "unrelated applet")
        metadata.unlink()
        for script in ("install.sh", "uninstall.sh"):
            self.run_script(script, expected=1)
        metadata.symlink_to(self.source / "package/metadata.json")
        for script in ("install.sh", "uninstall.sh"):
            self.run_script(script, expected=1)
        self.assertTrue(metadata.is_symlink())
        self.assertEqual(self.commands(), [])

    def test_foreign_source_metadata_fails_before_installation(self):
        (self.source / "package/metadata.json").write_text('{"KPlugin":{"Id":"org.example.foreign"}}')
        self.run_script("install.sh", expected=1)
        self.assertFalse(self.target.exists())
        self.assertEqual(self.commands(), [])

    def test_install_and_upgrade_failure_are_not_reported_successful(self):
        self.env["ALFC_PACKAGE_FAILURE"] = "29"
        failed = self.run_script("install.sh", expected=29)
        self.assertNotIn("Done.", failed.stdout)
        self.assertIn("--install", self.commands()[-1])
        shutil.copytree(self.source / "package", self.target)
        self.env["ALFC_PACKAGE_FAILURE_OPERATION"] = "--upgrade"
        failed = self.run_script("install.sh", expected=29)
        self.assertNotIn("Done.", failed.stdout)
        self.assertIn("--upgrade", self.commands()[-1])
        self.assertEqual(list(self.scratch.iterdir()), [])

    def test_incomplete_upgrade_candidate_preserves_the_working_user_package(self):
        shutil.copytree(self.source / "package", self.target)
        original = (self.target / "contents/ui/main.qml").read_bytes()
        (self.source / "package/contents/ui/main.qml").unlink()
        failed = self.run_script("install.sh", expected=4)
        self.assertNotIn("Done.", failed.stdout)
        self.assertEqual((self.target / "contents/ui/main.qml").read_bytes(), original)
        self.assertEqual(len(self.commands()), 1)
        self.assertIn("--install", self.commands()[0])
        self.assertNotEqual(self.commands()[0][3], str(self.target.parent))
        self.assertEqual(list(self.scratch.iterdir()), [])

    def test_symlink_and_non_directory_user_packages_are_rejected(self):
        self.target.parent.mkdir(parents=True)
        victim = self.root / "foreign"
        victim.mkdir()
        (victim / "keep").write_text("keep")
        for destination in (victim, self.root / "missing"):
            self.target.symlink_to(destination, target_is_directory=True)
            for script in ("install.sh", "uninstall.sh"):
                self.run_script(script, expected=1)
            self.assertTrue(self.target.is_symlink())
            self.target.unlink()
        self.target.write_text("foreign file")
        for script in ("install.sh", "uninstall.sh"):
            self.run_script(script, expected=1)
        self.assertEqual(self.target.read_text(), "foreign file")
        self.assertEqual((victim / "keep").read_text(), "keep")
        self.assertEqual(self.commands(), [])

    def test_relative_data_home_fails_before_mutation(self):
        self.env["XDG_DATA_HOME"] = "relative"
        for script in ("install.sh", "uninstall.sh"):
            self.run_script(script, expected=1)
        self.assertFalse((self.root / "relative").exists())
        self.assertEqual(self.commands(), [])

    def test_home_default_uses_the_same_explicit_user_root(self):
        del self.env["XDG_DATA_HOME"]
        self.run_script("install.sh")
        expected = Path(self.env["HOME"]) / ".local/share/plasma/plasmoids"
        self.assertEqual(self.commands()[-1][2:4], ["--packageroot", str(expected)])
        self.assertTrue((expected / "org.kde.alfc").is_dir())
        self.run_script("uninstall.sh")
        self.assertFalse((expected / "org.kde.alfc").exists())


if __name__ == "__main__":
    unittest.main()
