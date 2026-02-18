# AUR Package: alfc-bin

Arch User Repository package for ALFC (precompiled binary).

## Files

- `PKGBUILD` — Package build script
- `alfc.service` — systemd unit file
- `alfc.install` — Post-install/upgrade/remove hooks

## Updating the Package

1. Update `pkgver` in `PKGBUILD` to match the new release tag
2. Update `sha256sums` (or keep `SKIP` for development):
   ```bash
   updpkgsums
   ```
3. Generate `.SRCINFO`:
   ```bash
   makepkg --printsrcinfo > .SRCINFO
   ```
4. Test the build:
   ```bash
   makepkg -si
   ```

## Publishing to AUR

First time:

```bash
git clone ssh://aur@aur.archlinux.org/alfc-bin.git
cd alfc-bin
cp ../PKGBUILD ../alfc.service ../alfc.install .
makepkg --printsrcinfo > .SRCINFO
git add PKGBUILD .SRCINFO alfc.service alfc.install
git commit -m "Initial upload: alfc-bin 2.0.0"
git push
```

Subsequent updates:

```bash
# Update PKGBUILD version, regenerate .SRCINFO
makepkg --printsrcinfo > .SRCINFO
git add -u
git commit -m "Update to X.Y.Z"
git push
```

## File Layout (Installed)

```
/usr/bin/alfc                          → symlink to /usr/lib/alfc/alfc
/usr/lib/alfc/alfc                     # Server binary
/usr/lib/alfc/frontend/                # Web UI static files
/usr/lib/alfc/alfc.config.json         # Config (preserved on upgrade)
/usr/lib/alfc/plasmoid/                # KDE Plasma 6 widget package
/usr/lib/systemd/system/alfc.service   # systemd service
/usr/share/licenses/alfc-bin/LICENSE
/usr/share/doc/alfc-bin/README.md
/usr/share/doc/alfc-bin/LINUX.md
```
