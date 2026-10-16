#!/usr/bin/env python3
"""Install/remove only ALFC-owned module files, leaving shell.json to the user."""

import argparse
import json
import os
from pathlib import Path
import shutil
import tempfile


IDENTITY = "org.thatmarko.alfc.omarchy.v1\n"
FILES = ("Widget.qml", "Backend.qml", "Protocol.js")
MARKER = ".alfc-owned"


def destination():
    config = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")
    if not config.is_absolute():
        raise ValueError("XDG_CONFIG_HOME must be an absolute path")
    return config / "omarchy" / "bar" / "modules" / "alfc"


def check_owned(target):
    if target.is_symlink():
        raise ValueError(f"Refusing symlink module directory: {target}")
    if not target.exists():
        return False
    marker = target / MARKER
    if not target.is_dir() or marker.is_symlink() or not marker.is_file():
        raise ValueError(f"Refusing unowned module directory: {target}")
    if marker.read_text() != IDENTITY:
        raise ValueError(f"Unrecognized module ownership: {target}")
    for name in FILES:
        entry = target / name
        if entry.is_symlink() or (entry.exists() and not entry.is_file()):
            raise ValueError(f"Refusing non-regular owned file: {entry}")
    return True


def install(target, source):
    inputs = {name: source / "module" / name for name in FILES[:2]}
    inputs["Protocol.js"] = source.parent / "plasmoid/package/contents/ui/Protocol.js"
    for entry in inputs.values():
        if not entry.is_file():
            raise ValueError(f"Missing installable resource: {entry}")
    check_owned(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    # Stage in the destination filesystem. No command interpolation, elevated
    # process, shell config edit, or desktop restart is needed.
    with tempfile.TemporaryDirectory(prefix=".alfc-stage-", dir=target.parent) as staging:
        staged = Path(staging)
        for name, entry in inputs.items():
            shutil.copyfile(entry, staged / name)
            (staged / name).chmod(0o644)
        (staged / MARKER).write_text(IDENTITY)
        if not target.exists():
            staged.rename(target)
        else:
            check_owned(target)
            for name in FILES:
                (staged / name).replace(target / name)
    return {"id": "alfc", "type": "qml", "source": str(target / "Widget.qml")}


def remove(target):
    if not check_owned(target):
        return
    for name in FILES:
        (target / name).unlink(missing_ok=True)
    # Keep ownership when unrelated files remain, allowing a later reinstall
    # and repeated removal without claiming a foreign directory.
    if any(entry.name != MARKER for entry in target.iterdir()):
        return
    (target / MARKER).unlink()
    try:
        target.rmdir()
    except OSError:
        # The module directory can remain writable even when its parent no
        # longer allows removing it. Keep the leftover directory recognizable
        # for repeated removal or reinstallation in that case. Exclusive
        # creation also avoids overwriting a marker added during cleanup.
        with (target / MARKER).open("x") as marker:
            marker.write(IDENTITY)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("install", "remove"))
    args = parser.parse_args()
    try:
        target = destination()
        if args.action == "install":
            snippet = install(target, Path(__file__).resolve().parent)
            print("Installed. Add this single entry to a bar.layout section in your shell.json:")
            print(json.dumps(snippet, ensure_ascii=False))
            print("Existing layouts, themes, bindings, and autostart files were preserved.")
        else:
            remove(target)
            print("Owned module removed. Remove its layout entry from your shell.json.")
    except (OSError, ValueError) as error:
        parser.exit(1, f"ALFC module: {error}\n")


if __name__ == "__main__":
    main()
