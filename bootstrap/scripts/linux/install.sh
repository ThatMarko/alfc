#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Please run with sudo."
  exit 1
fi

# Service files and optional desktop resources must remain readable by the
# desktop user even when sudo preserves a restrictive caller umask.
umask 022

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="alfc"
INSTALL_DIR="/opt/alfc"

if [[ ! -f "${SCRIPT_DIR}/alfc" ]]; then
  echo "Expected alfc binary in ${SCRIPT_DIR}."
  exit 1
fi

if [[ ! -e /proc/acpi/call ]]; then
  echo "Warning: /proc/acpi/call not found. Make sure acpi_call is installed and loaded."
  echo "  Then load it:          sudo modprobe acpi_call"
  echo "  Auto-load on boot:     echo 'acpi_call' | sudo tee /etc/modules-load.d/acpi_call.conf"
  echo ""
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

install_files() {
  echo "Installing to ${INSTALL_DIR}..."

  # Stop existing service before overwriting files
  case "${INIT_SYSTEM}" in
    systemd)
      if [[ -f "/etc/systemd/system/${SERVICE_NAME}.service" ]] ||
        systemctl is-active --quiet "${SERVICE_NAME}"; then
        systemctl stop "${SERVICE_NAME}"
      fi
      ;;
    openrc)
      if [[ -f "/etc/init.d/${SERVICE_NAME}" ]]; then
        rc-service "${SERVICE_NAME}" stop
      fi
      ;;
  esac

  mkdir -p "${INSTALL_DIR}"
  chmod 755 "${INSTALL_DIR}"

  # Preserve existing config if present
  local preserve_config=false
  if [[ -f "${INSTALL_DIR}/alfc.config.json" ]]; then
    preserve_config=true
  fi

  # Binary
  cp "${SCRIPT_DIR}/alfc" "${INSTALL_DIR}/alfc"
  chmod 755 "${INSTALL_DIR}/alfc"

  # Frontend — remove old copy first to avoid nested dirs on upgrade
  rm -rf "${INSTALL_DIR}/frontend"
  cp -r "${SCRIPT_DIR}/frontend" "${INSTALL_DIR}/frontend"

  # Config — preserve user's existing config on upgrade
  if [[ "${preserve_config}" == "true" ]]; then
    echo "Preserved existing config at ${INSTALL_DIR}/alfc.config.json"
  else
    cp "${SCRIPT_DIR}/alfc.config.json" "${INSTALL_DIR}/alfc.config.json"
  fi

  # Optional desktop integrations; users opt in separately. Normalize the
  # owned resource tree so restrictive archive extraction cannot hide helpers
  # or QML/JS resources from the unprivileged desktop session.
  local desktop
  for desktop in plasmoid omarchy; do
    # These are owned release resources. An omitted optional integration in
    # the new release must retire its old installed version as well.
    rm -rf "${INSTALL_DIR}/${desktop}"
    if [[ -d "${SCRIPT_DIR}/${desktop}" ]]; then
      cp -r "${SCRIPT_DIR}/${desktop}" "${INSTALL_DIR}/${desktop}"
      find "${INSTALL_DIR}/${desktop}" -type d -exec chmod 755 {} +
      find "${INSTALL_DIR}/${desktop}" -type f -exec chmod 644 {} +
      find "${INSTALL_DIR}/${desktop}" -type f -name '*.sh' -exec chmod 755 {} +
    fi
  done

  # Management scripts — so users can uninstall/run from /opt/alfc
  for script in uninstall.sh run.sh; do
    if [[ -f "${SCRIPT_DIR}/${script}" ]]; then
      cp "${SCRIPT_DIR}/${script}" "${INSTALL_DIR}/${script}"
      chmod 755 "${INSTALL_DIR}/${script}"
    fi
  done

  # Symlink to /usr/bin so `alfc` is in PATH
  ln -sf "${INSTALL_DIR}/alfc" /usr/bin/alfc

  echo "Files installed to ${INSTALL_DIR}"
}

install_systemd() {
  local service_file="/etc/systemd/system/${SERVICE_NAME}.service"
  local template="${SCRIPT_DIR}/alfc.service"

  if [[ ! -f "${template}" ]]; then
    echo "Error: service template not found at ${template}"
    exit 1
  fi

  sed "s|@@INSTALL_DIR@@|${INSTALL_DIR}|g" "${template}" >"${service_file}"
  chmod 644 "${service_file}"

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

command="${INSTALL_DIR}/alfc"
command_background=true
retry="TERM/15/KILL/5"
pidfile="/run/\${name}.pid"
directory="${INSTALL_DIR}"

export NODE_ENV=production

depend() {
    need localmount
    after modules
}

start_pre() {
    if [ ! -e /proc/acpi/call ]; then
        ewarn "/proc/acpi/call not found. Make sure acpi_call is loaded."
    fi
}
EOF

  chmod 755 "${init_script}"
  rc-update add "${SERVICE_NAME}" default
  rc-service "${SERVICE_NAME}" restart
  echo "Service installed via OpenRC and started."
}

INIT_SYSTEM="$(detect_init)"
if [[ "${INIT_SYSTEM}" == "unknown" ]]; then
  echo "Could not detect init system (systemd or OpenRC); no files were changed."
  echo "You can run the extracted release manually with: sudo ./run.sh"
  exit 1
fi

for required in alfc.config.json uninstall.sh run.sh; do
  if [[ ! -f "${SCRIPT_DIR}/${required}" ]]; then
    echo "Release is incomplete: missing regular file ${required}; no files were changed."
    exit 1
  fi
done
if [[ ! -d "${SCRIPT_DIR}/frontend" ]]; then
  echo "Release is incomplete: frontend must be a directory; no files were changed."
  exit 1
fi
if [[ "${INIT_SYSTEM}" == "systemd" && ! -f "${SCRIPT_DIR}/alfc.service" ]]; then
  echo "Release is incomplete: missing alfc.service; no files were changed."
  exit 1
fi
if [[ "${SCRIPT_DIR}" == "${INSTALL_DIR}" ]]; then
  echo "Extract the new release outside ${INSTALL_DIR} before installing."
  exit 1
fi

# A command link alone cannot establish ownership of files reached through
# another symlink. Refuse redirected destinations before stopping services,
# copying/chmodding executables, or truncating the service definition.
if [[ -L "${INSTALL_DIR}" || ( -e "${INSTALL_DIR}" && ! -d "${INSTALL_DIR}" ) ]]; then
  echo "${INSTALL_DIR} must be a real installation directory; no files were changed."
  exit 1
fi
case "${INIT_SYSTEM}" in
  systemd) service_path="/etc/systemd/system/${SERVICE_NAME}.service" ;;
  openrc) service_path="/etc/init.d/${SERVICE_NAME}" ;;
esac
for destination in "${INSTALL_DIR}/alfc" "${INSTALL_DIR}/alfc.config.json" \
  "${INSTALL_DIR}/run.sh" "${INSTALL_DIR}/uninstall.sh" "${service_path}"; do
  if [[ -L "${destination}" || ( -e "${destination}" && ! -f "${destination}" ) ]]; then
    echo "Refusing redirected or non-file destination ${destination}; no files were changed."
    exit 1
  fi
done
if [[ -e /usr/bin/alfc || -L /usr/bin/alfc ]]; then
  if [[ "$(readlink /usr/bin/alfc || true)" != "${INSTALL_DIR}/alfc" ]]; then
    echo "/usr/bin/alfc belongs to another installation; remove it with its package manager first."
    exit 1
  fi
fi

install_files

case "${INIT_SYSTEM}" in
  systemd) install_systemd ;;
  openrc)  install_openrc ;;
esac

echo ""
echo "  UI available at http://localhost:5522"
echo ""
echo "  Installed to:  ${INSTALL_DIR}"
echo "  Config file:   ${INSTALL_DIR}/alfc.config.json"
echo "  Uninstall:     sudo ${INSTALL_DIR}/uninstall.sh"
if [[ -d "${INSTALL_DIR}/plasmoid" ]]; then
  echo ""
  echo "  KDE Plasma 6 widget (optional):"
  echo "    ${INSTALL_DIR}/plasmoid/install.sh"
fi
if [[ -d "${INSTALL_DIR}/omarchy" ]]; then
  echo ""
  echo "  Omarchy status/launcher module (optional, run as desktop user):"
  echo "    ${INSTALL_DIR}/omarchy/install.sh"
fi
