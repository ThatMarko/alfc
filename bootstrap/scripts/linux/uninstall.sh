#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Please run with sudo."
  exit 1
fi

SERVICE_NAME="alfc"

detect_init() {
  if [[ -d /run/systemd/system ]]; then
    echo "systemd"
  elif command -v rc-service >/dev/null 2>&1; then
    echo "openrc"
  else
    echo "unknown"
  fi
}

uninstall_systemd() {
  local service_file="/etc/systemd/system/${SERVICE_NAME}.service"

  systemctl stop "${SERVICE_NAME}" || true
  systemctl disable "${SERVICE_NAME}" || true
  rm -f "${service_file}"
  systemctl daemon-reload
  systemctl reset-failed "${SERVICE_NAME}" || true
}

uninstall_openrc() {
  local init_script="/etc/init.d/${SERVICE_NAME}"

  rc-service "${SERVICE_NAME}" stop || true
  rc-update del "${SERVICE_NAME}" default || true
  rm -f "${init_script}"
}

INIT_SYSTEM="$(detect_init)"

case "${INIT_SYSTEM}" in
  systemd) uninstall_systemd ;;
  openrc)  uninstall_openrc ;;
  *)
    echo "Could not detect init system (systemd or OpenRC)."
    echo "If alfc is running, you can stop it manually: kill \$(pidof alfc)"
    exit 1
    ;;
esac

echo "Service removed."
