#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ID="org.kde.alfc"

if ! command -v kpackagetool6 &>/dev/null; then
  echo "Error: kpackagetool6 not found."
  exit 1
fi

kpackagetool6 --type Plasma/Applet --remove "${PLUGIN_ID}" || echo "Plasmoid not installed."
echo "Plasmoid removed."
