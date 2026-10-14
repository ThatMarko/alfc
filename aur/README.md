# AUR package: alfc-bin

This directory prepares an **unpublished** x86_64 package for the glibc Linux
release. A stable, published release and its verified archive digest are required
before submitting it to the AUR. The current `SKIP` checksum is a development
placeholder and must never be shipped as a published package.

## Package sources and service

`PKGBUILD` downloads `alfc-v${pkgver}-linux-x64.tar.gz` from the matching GitHub tag.
It installs the executable and UI into `/usr/lib/alfc`, creates `/usr/bin/alfc`,
marks `usr/lib/alfc/alfc.config.json` as a pacman backup file, and places docs and
license files under the usual `/usr/share` locations. Widget scripts retain their
executable permission; the widget itself is installed in each user's account.
The documentation directory preserves root/common/widget/AUR Markdown paths so
relative links in the installed README remain usable.

The service is generated from the archive's
`bootstrap/scripts/linux/alfc.service` template, delivered at archive root as
`alfc.service`. `@@INSTALL_DIR@@` becomes `/usr/lib/alfc`. `aur/alfc.service` is a
rendered reference copy and must remain identical after that substitution.
The service uses root for ACPI/sysfs access, loopback-only networking, a 15-second
shutdown allowance, and systemd filesystem hardening. It is not enabled by the
package automatically.

Do not run the manual `/opt/alfc` installer over an AUR installation. The manual
installer rejects a command owned by another installation; use pacman to remove
or update the AUR package instead.

## Prepare and verify a release

1. Set `pkgver` to the release version without the `v` prefix and reset `pkgrel` to 1.
2. Download the published archive and `SHA256SUMS`. Verify the release asset digest,
   then run `updpkgsums` to replace `SKIP` with that pinned digest.
3. Generate `.SRCINFO` with `makepkg --printsrcinfo > .SRCINFO`.
4. Review `PKGBUILD`, `.SRCINFO`, and hooks; run `makepkg --verifysource` and test
   `makepkg -si` on an isolated Arch machine. This changes system packages and is
   not part of cloud unit tests.
5. Validate service start, stop, upgrade, preserved configuration, and widget
   installation on supported hardware before publishing.

For the first submission, clone `ssh://aur@aur.archlinux.org/alfc-bin.git` and copy
`PKGBUILD` and `alfc.install` from this checkout. Generate `.SRCINFO` in that AUR
checkout, commit those three files, and push it. Later updates follow the same
version/checksum/source-info sequence. Do not assume a path such as `../PKGBUILD`
points back to this repository after cloning elsewhere.

## User operations

After the package is published, install with an AUR helper, install a matching
`acpi_call` or `acpi_call-dkms` module and kernel headers, then run:

```sh
sudo modprobe acpi_call
sudo systemctl enable --now alfc
journalctl -u alfc -f
```

The UI is at `http://localhost:5522`; explicit IPv4 and IPv6 loopback URLs also
work when the respective address family is available. Install the optional KDE
widget as the desktop user:

```sh
kpackagetool6 --type Plasma/Applet --install /usr/lib/alfc/plasmoid/package
```

After an upgrade, restart the service and use `--upgrade` for an already installed
widget. Pacman preserves a modified configuration as `.pacsave` on removal.
