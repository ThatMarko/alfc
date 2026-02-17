#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Please run with sudo."
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="alfc"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
BINARY_PATH="${ROOT_DIR}/alfc"
ESCAPED_ROOT_DIR="$(systemd-escape --path "${ROOT_DIR}")"
ESCAPED_BINARY_PATH="$(systemd-escape --path "${BINARY_PATH}")"

if [[ ! -x "${BINARY_PATH}" ]]; then
  echo "Expected executable at ${BINARY_PATH}."
  exit 1
fi

if [[ ! -e /proc/acpi/call ]]; then
  echo "Warning: /proc/acpi/call not found. Make sure acpi_call is installed and loaded."
fi

cat >"${SERVICE_FILE}" <<EOF
[Unit]
Description=Aorus Laptop Fan Control
After=network.target

[Service]
Type=simple
WorkingDirectory=${ESCAPED_ROOT_DIR}
ExecStart=${ESCAPED_BINARY_PATH}
Environment=NODE_ENV=production
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

echo "Service installed and started."
echo "UI available at http://localhost:5522"
