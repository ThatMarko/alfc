#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="${SCRIPT_DIR}/package"
PLUGIN_ID="org.kde.alfc"

# Check kpackagetool6 exists
if ! command -v kpackagetool6 &>/dev/null; then
  echo "Error: kpackagetool6 not found. Is KDE Plasma 6 installed?"
  exit 1
fi

# Check if already installed -> upgrade, else install
if kpackagetool6 --type Plasma/Applet --show "${PLUGIN_ID}" &>/dev/null; then
  echo "Upgrading existing plasmoid..."
  kpackagetool6 --type Plasma/Applet --upgrade "${PACKAGE_DIR}"
else
  echo "Installing plasmoid..."
  kpackagetool6 --type Plasma/Applet --install "${PACKAGE_DIR}"
fi

echo "Done. You may need to restart Plasma (plasmashell) or log out/in."
echo "To add: right-click panel -> Add Widgets -> search 'Aorus'"
