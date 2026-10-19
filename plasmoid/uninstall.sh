#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ID="org.kde.alfc"
DATA_HOME="${XDG_DATA_HOME:-${HOME:?HOME is not set}/.local/share}"
if [[ "${DATA_HOME}" != /* ]]; then
  echo "Error: XDG_DATA_HOME must be an absolute path." >&2
  exit 1
fi
PACKAGE_ROOT="${DATA_HOME}/plasma/plasmoids"
INSTALLED_PACKAGE="${PACKAGE_ROOT}/${PLUGIN_ID}"

if [[ -L "${INSTALLED_PACKAGE}" || ( -e "${INSTALLED_PACKAGE}" && ! -d "${INSTALLED_PACKAGE}" ) ]]; then
  echo "Error: refusing a symlink or non-directory user package: ${INSTALLED_PACKAGE}" >&2
  exit 1
fi

if ! command -v kpackagetool6 &>/dev/null; then
  echo "Error: kpackagetool6 not found."
  exit 1
fi

if [[ ! -d "${INSTALLED_PACKAGE}" ]]; then
  echo "Plasmoid not installed for this user."
  exit 0
fi

if ! command -v python3 &>/dev/null; then
  echo "Error: python3 is required to verify package ownership." >&2
  exit 1
fi
# KPackage chooses the directory to remove from metadata's plugin ID. Verify
# that an ALFC-named directory cannot redirect removal to a neighboring applet.
python3 - "${INSTALLED_PACKAGE}/metadata.json" <<'PY'
import json
from pathlib import Path
import sys

entry = Path(sys.argv[1])
try:
    if entry.is_symlink() or not entry.is_file():
        raise ValueError("metadata must be a regular file")
    metadata = json.loads(entry.read_text(encoding="utf-8"))
    plugin = metadata.get("KPlugin") if isinstance(metadata, dict) else None
    if not isinstance(plugin, dict) or plugin.get("Id") != "org.kde.alfc":
        raise ValueError("KPlugin.Id must be org.kde.alfc")
except (OSError, UnicodeError, ValueError) as error:
    sys.exit(f"Error: refusing package metadata {entry}: {error}")
PY

kpackagetool6 --type Plasma/Applet --packageroot "${PACKAGE_ROOT}" --remove "${PLUGIN_ID}"
echo "Plasmoid removed."
