#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="${SCRIPT_DIR}/package"
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

# Check kpackagetool6 exists
if ! command -v kpackagetool6 &>/dev/null; then
  echo "Error: kpackagetool6 not found. Is KDE Plasma 6 installed?"
  exit 1
fi

if ! command -v python3 &>/dev/null; then
  echo "Error: python3 is required to verify package ownership." >&2
  exit 1
fi
metadata_files=("${PACKAGE_DIR}/metadata.json")
if [[ -d "${INSTALLED_PACKAGE}" ]]; then
  metadata_files+=("${INSTALLED_PACKAGE}/metadata.json")
fi
# KPackage derives the uninstall target from metadata, including while
# upgrading. A directory named org.kde.alfc must not name another applet there.
python3 - "${metadata_files[@]}" <<'PY'
import json
from pathlib import Path
import sys

for name in sys.argv[1:]:
    entry = Path(name)
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

# --show also searches system packages, so it cannot establish whether this
# user has an installation to upgrade. Mutations explicitly target this root.
if [[ -d "${INSTALLED_PACKAGE}" ]]; then
  # KPackage's upgrade removes the old package before installing the new one.
  # Validate the candidate using the real package structure in a private root
  # first, so an incomplete release cannot delete a working installation.
  CHECK_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/alfc-plasmoid-check.XXXXXX")"
  cleanup_check() {
    check_status=$?
    trap - EXIT
    rm -rf -- "${CHECK_ROOT}" || true
    exit "${check_status}"
  }
  trap cleanup_check EXIT
  echo "Checking package before upgrading..."
  kpackagetool6 --type Plasma/Applet --packageroot "${CHECK_ROOT}" --install "${PACKAGE_DIR}"
  rm -rf -- "${CHECK_ROOT}"
  trap - EXIT
  echo "Upgrading existing plasmoid..."
  kpackagetool6 --type Plasma/Applet --packageroot "${PACKAGE_ROOT}" --upgrade "${PACKAGE_DIR}"
else
  echo "Installing plasmoid..."
  kpackagetool6 --type Plasma/Applet --packageroot "${PACKAGE_ROOT}" --install "${PACKAGE_DIR}"
fi

echo "Done. You may need to restart Plasma (plasmashell) or log out/in."
echo "To add: right-click panel -> Add Widgets -> search 'Aorus'"
