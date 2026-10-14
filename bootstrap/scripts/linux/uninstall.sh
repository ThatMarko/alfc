#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Please run with sudo."
  exit 1
fi

SERVICE_NAME="alfc"
INSTALL_DIR="/opt/alfc"
PURGE=false

for arg in "$@"; do
  case "${arg}" in
    --purge) PURGE=true ;;
    --help) echo "Usage: $0 [--purge]"; exit 0 ;;
    *) echo "Unknown argument: ${arg}"; exit 1 ;;
  esac
done

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

  if [[ -f "${service_file}" ]] || systemctl is-active --quiet "${SERVICE_NAME}"; then
    systemctl stop "${SERVICE_NAME}"
  fi
  systemctl disable "${SERVICE_NAME}" 2>/dev/null || true
  rm -f "${service_file}"
  systemctl daemon-reload
  systemctl reset-failed "${SERVICE_NAME}" 2>/dev/null || true
  echo "Service removed (systemd)."
}

uninstall_openrc() {
  local init_script="/etc/init.d/${SERVICE_NAME}"

  if [[ -f "${init_script}" ]]; then
    rc-service "${SERVICE_NAME}" stop
  fi
  rc-update del "${SERVICE_NAME}" default 2>/dev/null || true
  rm -f "${init_script}"
  echo "Service removed (OpenRC)."
}

# Remove service
INIT_SYSTEM="$(detect_init)"

case "${INIT_SYSTEM}" in
  systemd) uninstall_systemd ;;
  openrc)  uninstall_openrc ;;
  *)
    echo "Could not detect init system; no files were removed."
    echo "Stop ALFC with its service manager before removing ${INSTALL_DIR}."
    exit 1
    ;;
esac

# Remove symlink
if [[ "$(readlink /usr/bin/alfc || true)" == "${INSTALL_DIR}/alfc" ]]; then
  rm -f /usr/bin/alfc
fi

# Remove installed files
if [[ -d "${INSTALL_DIR}" ]]; then
  if [[ "${PURGE}" == "true" ]]; then
    rm -rf "${INSTALL_DIR}"
    echo "Removed ${INSTALL_DIR} (including config)."
  else
    # Keep config, remove everything else
    find "${INSTALL_DIR}" -mindepth 1 -maxdepth 1 ! -name 'alfc.config.json' \
      -exec rm -rf -- {} +
    if [[ -f "${INSTALL_DIR}/alfc.config.json" ]]; then
      echo "Config preserved at ${INSTALL_DIR}/alfc.config.json"
      echo "  Use --purge to remove everything including config."
    else
      rm -rf "${INSTALL_DIR}"
    fi
  fi
fi

echo ""
echo "ALFC uninstalled."
echo ""
echo "To remove the KDE widget (if installed):"
echo "  kpackagetool6 --type Plasma/Applet --remove org.kde.alfc"
