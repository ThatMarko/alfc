# Aorus Laptop Fan Control (alfc) - Linux Guide

Linux pros - feel free to contribute either to the following guide or automating the
workflow! 🙂 (See notes in the Wishlist section though.)

## IMPORTANT

**Only use this on Linux if your machine is listed in the compatibility table in the main readme or if you know what you're doing.**

Because on Linux, this tool writes directly to hardware addresses where data persists after rebooting. If something goes wrong, you might need to do something [like this](https://github.com/hirschmann/nbfc/wiki/FAQ#is-there-a-way-to-reset-my-notebook-if-something-went-wrong).

As for how to figure out whether the addresses are the same on your machine – not that simple, I might do a talk or write an article at some point. Let me know if you actually need this.

## Prerequisites

### Install `acpi_call`

This enables issuing fan control commands.

If you have secure boot enabled, you need to do [this](https://gist.github.com/s-h-a-d-o-w/53c2215e955c3326c6ec8f812a0d2f27) first.

Download or clone https://github.com/nix-community/acpi_call (the `acpi_callback` version in your package manager might not be compatible or break [as it gets updates](https://github.com/s-h-a-d-o-w/alfc/issues/1)!) and run:

```
sudo make dkms-add
sudo make dkms-build
sudo make dkms-install
sudo modprobe acpi_call
```

#### Troubleshooting `acpi_call` installation

At least on Mint, I never needed the following but...

- `make` will tell you if you're missing compilers.

- You might need to install the headers for your kernel version: https://github.com/s-h-a-d-o-w/alfc/issues/6#issue-1218677080.

### Run `acpi_call` on startup

**systemd** (Arch, Fedora, Ubuntu, openSUSE, etc.):

Put `acpi_call` into `/etc/modules-load.d/acpi_call.conf`. See the [Arch wiki](https://wiki.archlinux.org/title/Kernel_module#Automatic_module_loading_with_systemd) for details.

**OpenRC** (Alpine, Artix, Gentoo, etc.):

Add `acpi_call` to `/etc/modules` (one module name per line). On Gentoo, use `/etc/conf.d/modules` instead.

## Installation

- Grab the latest alfc Linux release
- Extract it to wherever you want the tool to live
- Run `sudo ./install.sh`.

  The installer auto-detects your init system (systemd or OpenRC) and creates the appropriate service.

- Go to `http://localhost:5522` to configure things.

### Run without installing a service

- Run `sudo ./run.sh`.
- Stop it with `Ctrl+C`.

### Installation troubleshooting

**systemd**: If you get an error like `bin/sh: no command service`, try:

```
sudo systemctl enable alfc
sudo systemctl start alfc
```

**OpenRC**: If the service doesn't start, try:

```
sudo rc-update add alfc default
sudo rc-service alfc start
```

### Uninstall

- Run `sudo ./uninstall.sh`.

## KDE Plasma 6 Widget (Optional)

If you're running KDE Plasma 6, you can install the native Plasma widget for system tray fan control.

### Prerequisites

- KDE Plasma 6 desktop environment
- QtWebSockets QML module (see `plasmoid/DEPENDENCIES.md` for distro-specific package names)
- The ALFC backend service must be running (`sudo ./install.sh` or `sudo ./run.sh`)

### Install

```bash
./plasmoid/install.sh
```

Or manually:

```bash
kpackagetool6 --type Plasma/Applet --install plasmoid/package
```

After installing, right-click your panel → Add Widgets → search for "Aorus".

### Upgrade

```bash
./plasmoid/install.sh
```

The script detects an existing install and upgrades automatically.

### Uninstall

```bash
./plasmoid/uninstall.sh
```

### Testing / Development

```bash
plasmoidviewer -a plasmoid/package
# or
plasmawindowed org.kde.alfc
```

## Wishlist

- Somehow include `acpi_call` in the installation process. But there are two problems:
  1. People who have secure boot enabled need that whole separate step of signing the module.
  2. How the module can be loaded on startup might vary from distro to distro.
