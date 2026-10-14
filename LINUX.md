# ALFC on Linux

Use ALFC on a laptop whose firmware interface has been verified against the
[compatibility information](README.md). ACPI writes change hardware state and can
outlive the process. Cloud tests cannot establish that another laptop uses
the same firmware methods.

## Requirements

Published Linux archives target x86_64 with glibc. systemd and OpenRC service
scripts are included; an OpenRC machine still needs a compatible binary.
Musl-only distributions such as a default Alpine installation need a separately
validated musl build or compatible runtime; the glibc archive is not universal.

Install the `acpi_call` kernel module and headers matching your running kernel.
On Arch-based systems:

```sh
sudo pacman -S acpi_call-dkms
sudo modprobe acpi_call
```

For other distributions, use their matching kernel-module packages or follow
[nix-community/acpi_call](https://github.com/nix-community/acpi_call). Secure Boot
may require signing the module according to your distribution's instructions;
do not disable signature enforcement as an installation shortcut.

Check that `/proc/acpi/call` exists. On systemd, enable loading on boot with:

```sh
echo acpi_call | sudo tee /etc/modules-load.d/acpi_call.conf
```

On OpenRC, configure your distribution's module loader (`/etc/modules` on some
systems or `/etc/conf.d/modules` on Gentoo). Fan access and Intel RAPL CPU tuning
are separate capabilities. RAPL may be unavailable even when fan control works.
The UI and widget display backend availability rather than assuming all hardware
features exist.

## Install, upgrade, or run temporarily

Download a published Linux archive and `SHA256SUMS` from the same release. Verify
the archive's SHA-256 entry before extracting it. Keep the extracted release
outside `/opt/alfc`, then run its installer:

```sh
sudo ./install.sh
```

The installer validates required files and service-manager support before making
changes, stops an existing service before replacing files, installs under
`/opt/alfc`, and creates `/usr/bin/alfc`. It preserves existing
`/opt/alfc/alfc.config.json` on upgrades and removes obsolete frontend assets.
Run the installer again from a newly extracted release to upgrade. It refuses to
overwrite `/usr/bin/alfc` if that command belongs to another installation.

For a temporary foreground run without installing a service:

```sh
sudo ./run.sh
```

Stop it with Ctrl+C. Avoid running a service and a foreground instance together.
The required IPv4 listener and optional IPv6 listener use port 5522, so a second
instance fails instead of sharing control. Open `http://localhost:5522` or
`http://127.0.0.1:5522`; `http://[::1]:5522` works when IPv6 is available. The
privileged backend deliberately listens only on loopback.

The unpublished AUR package is documented in [aur/README.md](aur/README.md).
Once published, use its package manager for installation and upgrades rather
than mixing it with the manual `/opt/alfc` installation.

## Stop and uninstall

Normal shutdown stops admitted work and attempts both BIOS automatic-control
commands within a bounded budget. systemd and OpenRC grant at least 15 seconds
before forced termination. A hung native call or forced kill can still prevent a
confirmed firmware handoff; check shutdown logs when diagnosing control problems.

```sh
sudo /opt/alfc/uninstall.sh
```

This stops the service before deleting files and preserves only the top-level
configuration. To delete it too, run the same command with `--purge`. A failed
service stop or unknown init system aborts removal, leaving files in place.
Uninstall the per-user widget separately.

## Troubleshooting

For systemd, inspect `systemctl status alfc` and `journalctl -u alfc -f`. For
OpenRC, use `rc-service alfc status`; the generated background service does not
capture stdout/stderr into a dedicated file. Stop it and use `run.sh` for foreground
logs when needed.

An execution failure such as systemd `203/EXEC` can indicate an absent executable,
missing execute permission, wrong architecture, or a missing glibc loader. Check
`ls -l /opt/alfc/alfc` and that the archive matches the host. An unavailable fan
backend requires checking module loading, `/proc/acpi/call`, and firmware support.
An unavailable CPU tuner requires checking Intel RAPL sysfs support; it does not
justify treating fan commands as failed. A port conflict must be resolved by
stopping the other instance, not by opening the service on all network interfaces.
If ALFC started before `acpi_call` was loaded, load the module and restart ALFC
(`sudo systemctl restart alfc` or `sudo rc-service alfc restart`). Availability is
cached for the process; loading the module alone does not refresh the capability.

## KDE Plasma 6 widget

Install QtWebSockets QML support using the package names in
[plasmoid/DEPENDENCIES.md](plasmoid/DEPENDENCIES.md). Then, as the desktop user:

```sh
/opt/alfc/plasmoid/install.sh
```

The helper upgrades an existing installation. Alternatively use
`kpackagetool6 --type Plasma/Applet --install /opt/alfc/plasmoid/package`, replacing
`--install` with `--upgrade` for an existing widget. Add the widget through Plasma's
Add Widgets interface. Remove it with `/opt/alfc/plasmoid/uninstall.sh` before
removing the backend installation, or with
`kpackagetool6 --type Plasma/Applet --remove org.kde.alfc` afterward.

The widget depends on the running backend and mirrors its capabilities and
confirmed state. See [plasmoid/README.md](plasmoid/README.md) for supported controls,
connection settings, and runtime test instructions. For development,
`plasmoidviewer -a plasmoid/package` requires the Plasma development tools;
`plasmawindowed org.kde.alfc` opens an installed widget.
