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

# The service name is shared with packaged installations. A foreign command
# means this manual uninstaller cannot safely claim ownership of that service.
# Check before stopping/disabling it or removing any installation files.
if [[ -e /usr/bin/alfc || -L /usr/bin/alfc ]]; then
  if [[ "$(readlink /usr/bin/alfc || true)" != "${INSTALL_DIR}/alfc" ]]; then
    echo "/usr/bin/alfc belongs to another installation; remove it with its package manager first."
    exit 1
  fi
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

uninstall_systemd() {
  local service_file="/etc/systemd/system/${SERVICE_NAME}.service"

  if [[ -f "${service_file}" ]] || systemctl is-active --quiet "${SERVICE_NAME}"; then
    systemctl stop "${SERVICE_NAME}"
  fi
  if [[ -f "${service_file}" ]] || systemctl is-enabled --quiet "${SERVICE_NAME}"; then
    if systemctl disable "${SERVICE_NAME}"; then
      :
    else
      local disable_status=$?
      echo "ALFC was stopped, but disabling its service failed; installation files were kept for retry." >&2
      return "${disable_status}"
    fi
  fi
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
  local runlevel_link="/etc/runlevels/default/${SERVICE_NAME}"
  if [[ -e "${runlevel_link}" || -L "${runlevel_link}" ]]; then
    if rc-update del "${SERVICE_NAME}" default; then
      :
    else
      local disable_status=$?
      echo "ALFC was stopped, but removing its default runlevel registration failed; installation files were kept for retry." >&2
      return "${disable_status}"
    fi
  fi
  rm -f "${init_script}"
  echo "Service removed (OpenRC)."
}

# Remove service
INIT_SYSTEM="$(detect_init)"

# A symlinked installation root or service definition can refer to another
# installation even when /usr/bin/alfc still has the expected literal target.
if [[ -L "${INSTALL_DIR}" || ( -e "${INSTALL_DIR}" && ! -d "${INSTALL_DIR}" ) ]]; then
  echo "Refusing redirected or non-directory installation ${INSTALL_DIR}; no files were removed."
  exit 1
fi
case "${INIT_SYSTEM}" in
  systemd) service_path="/etc/systemd/system/${SERVICE_NAME}.service" ;;
  openrc) service_path="/etc/init.d/${SERVICE_NAME}" ;;
  *) service_path="" ;;
esac
if [[ -n "${service_path}" && ( -L "${service_path}" || ( -e "${service_path}" && ! -f "${service_path}" ) ) ]]; then
  echo "Refusing redirected or non-file service definition ${service_path}; no files were removed."
  exit 1
fi

if [[ "${INIT_SYSTEM}" == "openrc" ]]; then
  runlevel_link="/etc/runlevels/default/${SERVICE_NAME}"
  if [[ -e "${runlevel_link}" || -L "${runlevel_link}" ]]; then
    if [[ ! -L "${runlevel_link}" ||
          "$(readlink -f -- "${runlevel_link}" || true)" != "${service_path}" ]]; then
      echo "Refusing foreign default-runlevel registration ${runlevel_link}; no service changes were made."
      exit 1
    fi
  fi
fi

# The service name is shared with other installations. Verify its declared
# executable independently of the launcher symlink before stopping/replacing it.
if [[ -n "${service_path}" && -f "${service_path}" ]]; then
  case "${INIT_SYSTEM}" in
    systemd) declared_command="$(sed -n 's/^[[:space:]]*ExecStart[[:space:]]*=[[:space:]]*//p' "${service_path}")" ;;
    openrc) declared_command="$(sed -n 's/^[[:space:]]*command[[:space:]]*=[[:space:]]*//p' "${service_path}")" ;;
  esac
  if [[ "${declared_command}" != "${INSTALL_DIR}/alfc" &&
        "${declared_command}" != "\"${INSTALL_DIR}/alfc\"" &&
        "${declared_command}" != "'${INSTALL_DIR}/alfc'" ]]; then
    echo "Refusing service definition ${service_path}: it does not name this installation's executable."
    exit 1
  fi
fi
if [[ "${INIT_SYSTEM}" == "systemd" ]]; then
  # Resolve vendor/runtime units as well; absence of the manual unit does not
  # establish that the service name is unused. 'show' is read-only and reports
  # LoadState=not-found for a genuinely absent unit.
  service_properties="$(systemctl show --property=LoadState --property=FragmentPath "${SERVICE_NAME}")"
  load_state=""
  fragment_path=""
  while IFS='=' read -r key value; do
    case "${key}" in
      LoadState) load_state="${value}" ;;
      FragmentPath) fragment_path="${value}" ;;
    esac
  done <<<"${service_properties}"
  if [[ "${fragment_path}" != "${service_path}" &&
        ( "${load_state}" != "not-found" || -n "${fragment_path}" ) ]]; then
    echo "Refusing service ${SERVICE_NAME}: systemd does not resolve it to ${service_path}."
    exit 1
  fi
fi

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
