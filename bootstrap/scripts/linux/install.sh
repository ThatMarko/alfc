#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Please run with sudo."
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="alfc"
BINARY_PATH="${ROOT_DIR}/alfc"

if [[ ! -x "${BINARY_PATH}" ]]; then
  echo "Expected executable at ${BINARY_PATH}."
  exit 1
fi

if [[ ! -e /proc/acpi/call ]]; then
  echo "Warning: /proc/acpi/call not found. Make sure acpi_call is installed and loaded."
fi

detect_init() {
  if [[ -d /run/systemd/system ]]; then
    echo "systemd"
  elif command -v rc-service >/dev/null 2>&1; then
    echo "openrc"
  else
    echo "unknown"
  fi
}

install_systemd() {
  local service_file="/etc/systemd/system/${SERVICE_NAME}.service"
  local escaped_root escaped_binary
  escaped_root="$(systemd-escape --path "${ROOT_DIR}")"
  escaped_binary="$(systemd-escape --path "${BINARY_PATH}")"

  cat >"${service_file}" <<EOF
[Unit]
Description=Aorus Laptop Fan Control
After=network.target

[Service]
Type=simple
WorkingDirectory=${escaped_root}
ExecStart=${escaped_binary}
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
  echo "Service installed via systemd and started."
}

install_openrc() {
  local init_script="/etc/init.d/${SERVICE_NAME}"

  cat >"${init_script}" <<'INITEOF'
#!/sbin/openrc-run

name="alfc"
description="Aorus Laptop Fan Control"
INITEOF

  cat >>"${init_script}" <<EOF

command="${BINARY_PATH}"
command_background=true
pidfile="/run/\${name}.pid"
directory="${ROOT_DIR}"

export NODE_ENV=production

depend() {
    need net
    after net
}

start_pre() {
    if [ ! -e /proc/acpi/call ]; then
        ewarn "/proc/acpi/call not found. Make sure acpi_call is loaded."
    fi
}
EOF

  chmod +x "${init_script}"
  rc-update add "${SERVICE_NAME}" default
  rc-service "${SERVICE_NAME}" restart
  echo "Service installed via OpenRC and started."
}

INIT_SYSTEM="$(detect_init)"

case "${INIT_SYSTEM}" in
  systemd) install_systemd ;;
  openrc)  install_openrc ;;
  *)
    echo "Could not detect init system (systemd or OpenRC)."
    echo "You can still run alfc manually with: sudo ./run.sh"
    exit 1
    ;;
esac

echo "UI available at http://localhost:5522"
