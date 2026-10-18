# AUR package: alfc-bin

This directory prepares an **unpublished** x86_64 package for the glibc Linux
release. A stable, published release and its verified archive digest are required
before submitting it to the AUR. The current `SKIP` checksums are development
placeholders and must never be shipped as a published package.
The [AUR RPC lookup](https://aur.archlinux.org/rpc/v5/info?arg%5B%5D=alfc-bin)
returned no `alfc-bin` package on 2026-10-15; recheck before claiming publication.

## Package sources and service

`PKGBUILD` downloads `alfc-v${pkgver}-linux-x64.tar.gz` from the matching GitHub tag.
It installs the executable and UI into `/usr/lib/alfc`, creates `/usr/bin/alfc`,
marks `usr/lib/alfc/alfc.config.json` as a pacman backup file, and places docs and
license files under the usual `/usr/share` locations. Widget scripts retain their
executable permission; the widget itself is installed in each user's account.
The documentation directory preserves root/common/widget/AUR Markdown paths so
relative links in the installed README remain usable.
The optional [Omarchy integration](../OMARCHY.md) helpers and Quickshell module
are staged under `/usr/lib/alfc/omarchy`; the packaged Plasma protocol guard
remains available for its user-session installer. Desktop integration is opt-in
and unprivileged. Its installer requires Python 3; the runtime requirements are
documented separately from the backend's native-library requirements.

The service is generated from the archive's
`bootstrap/scripts/linux/alfc.service` template, delivered at archive root as
`alfc.service`. `@@INSTALL_DIR@@` becomes `/usr/lib/alfc`. `aur/alfc.service` is a
rendered reference copy and must remain identical after that substitution.
The service uses root for ACPI/sysfs access, loopback-only networking, a 15-second
shutdown allowance, and systemd filesystem hardening. It is not enabled by the
package automatically.

The installed ALPM `PreTransaction` hook stops ALFC before an upgrade or removal
changes package files. `AbortOnFail` prevents that transaction when the helper
cannot verify the vendor unit and its effective executable or cannot finish the
stop. This also waits for an already activating or deactivating unit, which an
`is-active` check would skip. Policy drop-ins that retain the packaged executable
remain supported; an override that selects another installation is refused.
An unavailable systemd manager or an unverified/missing unit requires resolving
that service state before retrying; the helper does not claim an offline stop.
After upgrading, restart the service explicitly when it should be running.

This protection requires the hook to be installed before the transaction begins.
When migrating from an older package that lacks it, stop ALFC successfully before
the first upgrade or removal. Package hook overrides can also disable it.
The removal scriptlet's fallback stop returns failures, but libalpm ignores
scriptlet return values and continues removing files. The aborting hook is what
retains the package on a shutdown failure. See the pacman source
[hook documentation](https://github.com/devkitPro/pacman/blob/cf473bcfbd275044250fa6ce3703dd7059a52273/doc/alpm-hooks.5.asciidoc#L86-L88),
[transaction guard](https://github.com/devkitPro/pacman/blob/cf473bcfbd275044250fa6ce3703dd7059a52273/lib/libalpm/trans.c#L201-L204),
and [removal scriptlet call](https://github.com/devkitPro/pacman/blob/cf473bcfbd275044250fa6ce3703dd7059a52273/lib/libalpm/remove.c#L706-L713)
in its public source mirror. The effective-command check follows systemd's
[property output](https://github.com/systemd/systemd/blob/70bae7648f2c18010187c9cf20093155eaa26029/src/systemctl/systemctl-show.c#L1405-L1455).

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
`PKGBUILD`, `alfc.install`, `alfc-stop-service.hook`, and `alfc-package-stop` from
this checkout. Generate `.SRCINFO` in that AUR checkout, commit those five files,
and push it. Later updates follow the same
version/checksum/source-info sequence. Do not assume a path such as `../PKGBUILD`
points back to this repository after cloning elsewhere.

## User operations

After the package is published, install with an AUR helper and choose the
kernel module from the [Linux requirements](../LINUX.md#requirements).
`acpi_call` targets Arch's `linux` kernel; `acpi_call-lts` targets `linux-lts`.
Other kernels need a matching module package or `acpi_call-dkms` with that
kernel's headers. These module packages are alternatives. Then run:

```sh
sudo modprobe acpi_call
sudo systemctl enable --now alfc
journalctl -u alfc -f
```

The UI is at `http://localhost:5522`; explicit IPv4 and IPv6 loopback URLs also
work when the respective address family is available. Install the optional KDE
widget as the desktop user:

```sh
/usr/lib/alfc/plasmoid/install.sh
```

After an upgrade, restart the service and rerun the widget helper to upgrade an
already installed widget. To remove the widget, run
`/usr/lib/alfc/plasmoid/uninstall.sh` as the desktop user before removing the
package. If the package has already been removed, use `plasmoid/uninstall.sh`
from an extracted ALFC release. These helpers check the installed widget's
identity before changing it and require Python 3.

Pacman preserves a modified configuration as `.pacsave` on ordinary removal;
`--nosave` suppresses that backup. Inspect pacman's output and service logs if
the pre-transaction stop fails, then retry after resolving the shutdown issue.
The hook does not prove that unresponsive firmware completed its BIOS handoff.
