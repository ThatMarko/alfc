#!/usr/bin/env python3
"""Check local Markdown destinations and heading anchors in source or staged docs."""

import argparse
from collections import Counter
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import unquote, urlsplit


def prose(source):
    """Ignore fenced examples, whose placeholder paths aren't documentation links."""
    lines = []
    fence = None
    for line in source.splitlines():
        match = re.match(r"^\s*(`{3,}|~{3,})", line)
        if match:
            marker = match[1][0]
            if fence is None:
                fence = marker
            elif fence == marker:
                fence = None
            lines.append("")
        else:
            lines.append(line if fence is None else "")
    return "\n".join(lines)


def anchors(source):
    result = set(re.findall(r'<(?:a|h[1-6])\s+[^>]*(?:id|name)="([^"]+)"', source))
    counts = Counter()
    for heading in re.findall(r"^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$", prose(source), re.M):
        heading = re.sub(r"!?\[([^\]]+)\]\([^)]*\)", r"\1", heading)
        heading = re.sub(r"<[^>]+>", "", heading)
        slug = re.sub(r"[^\w\- ]", "", heading.lower()).replace(" ", "-")
        count = counts[slug]
        counts[slug] += 1
        result.add(slug + (f"-{count}" if count else ""))
    return result


def destinations(source):
    source = prose(source)
    definitions = dict(re.findall(r"^ {0,3}\[([^\]]+)\]:\s*<?([^\s>]+)>?", source, re.M))
    for match in re.finditer(r"!?\[[^\]\n]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+[^)]*)?\)", source):
        yield match.start(), match[1].strip("<>")
    for match in re.finditer(r"!?\[([^\]\n]+)\]\[([^\]\n]*)\]", source):
        name = match[2] or match[1]
        target = next((value for key, value in definitions.items() if key.casefold() == name.casefold()), None)
        if target:
            yield match.start(), target


def check(root, files):
    failures = []
    checked = 0
    for path in files:
        source = path.read_text(encoding="utf-8")
        for offset, destination in destinations(source):
            parts = urlsplit(destination)
            if parts.scheme or parts.netloc:
                continue
            target = (path.parent / unquote(parts.path)).resolve() if parts.path else path
            line = prose(source).count("\n", 0, offset) + 1
            label = f"{path.relative_to(root)}:{line}: {destination}"
            checked += 1
            if not target.is_relative_to(root):
                failures.append(f"{label}: destination escapes documentation root")
            elif not target.exists():
                failures.append(f"{label}: missing destination")
            elif parts.fragment and target.suffix.lower() == ".md":
                if unquote(parts.fragment) not in anchors(target.read_text(encoding="utf-8")):
                    failures.append(f"{label}: missing heading anchor")
    for failure in failures:
        print(failure, file=sys.stderr)
    print(f"Checked {checked} local links in {len(files)} Markdown files ({len(failures)} failures).")
    return bool(failures)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", type=Path, help="staged documentation root; defaults to tracked source")
    args = parser.parse_args()
    root = (args.root or Path(__file__).resolve().parents[1]).resolve()
    if args.root:
        files = sorted(root.rglob("*.md"))
    else:
        paths = subprocess.check_output(
            ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "*.md"], cwd=root
        ).decode().split("\0")
        files = sorted({root / path for path in paths if path and (root / path).is_file()})
    return check(root, files)


if __name__ == "__main__":
    sys.exit(main())
