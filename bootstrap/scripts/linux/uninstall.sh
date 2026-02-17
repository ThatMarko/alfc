#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Please run with sudo."
  exit 1
fi

SERVICE_NAME="alfc"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

systemctl stop "${SERVICE_NAME}" || true
systemctl disable "${SERVICE_NAME}" || true

rm -f "${SERVICE_FILE}"

systemctl daemon-reload
systemctl reset-failed "${SERVICE_NAME}" || true

echo "Service removed."
