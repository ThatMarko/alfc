# Releasing ALFC

## How to create a release

1. Update the version in `package.json` and `plasmoid/package/metadata.json`
2. Commit: `git commit -am "chore: release vX.Y.Z"`
3. Tag: `git tag vX.Y.Z`
4. Push: `git push origin master --tags`

The GitHub Actions release workflow will:

- Build Linux (x64) and Windows (x64) on their respective runners
- Run `bun run all-checks` (lint, typecheck, test, build) on Linux
- Build `WmiAPI.exe` (.NET Framework 4.8) on Windows
- Download WinSW service wrapper
- Assemble release archives
- Create a **draft** GitHub Release with all artifacts

Review the draft release, edit the notes if needed, then publish it.

5. After publishing, update the AUR package:
   ```bash
   cd /path/to/aur/alfc-bin
   # Update pkgver in PKGBUILD, then:
   updpkgsums
   makepkg --printsrcinfo > .SRCINFO
   git add -u && git commit -m "Update to vX.Y.Z" && git push
   ```

## Release artifacts

| Artifact                       | Contents                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `alfc-vX.Y.Z-linux-x64.tar.gz` | Server binary, frontend, service scripts, plasmoid, config, LICENSE, docs    |
| `alfc-vX.Y.Z-windows-x64.zip`  | Server binary, frontend, WmiAPI.exe, service scripts, WinSW, config, LICENSE |
| `org.kde.alfc.plasmoid`        | Standalone plasmoid package (zip of QML files for KDE Store)                 |

## Windows: CPU tuning (PL1/PL2)

The Windows release does **not** include `CPUOC.dll` or `IntelOverclockingSDK.dll`.
CPU power limit tuning requires the Intel Overclocking SDK, which is proprietary
and cannot be redistributed.

Fan control, GPU boost, and all other features work without it.

To enable CPU tuning:

1. Install [Intel XTU](https://www.intel.com/content/www/us/en/download/17881/intel-extreme-tuning-utility-intel-xtu.html)
2. Locate `IntelOverclockingSDK.dll` in the Intel XTU installation directory
3. Copy it to `server/native/windows/`
4. Build the CPUOC wrapper: `cd server && dotnet publish native/windows/cpuoc-dotnet -c Release -o native/windows`
5. Copy the resulting `CPUOC.dll` next to `alfc.exe`

## Distribution channels

### Current

- **GitHub Releases** — Primary distribution for all platforms

### Ready (pending first submission)

- **AUR** (Arch User Repository) — PKGBUILD is in `aur/`. Package name: `alfc-bin`. Submit after the first tagged release.
- **KDE Store** (store.kde.org) — The `org.kde.alfc.plasmoid` file can be uploaded to the KDE Store so Plasma users can discover and install the widget directly from KDE Discover. The backend still needs to be installed separately from GitHub Releases.

### Not viable

- **Flatpak** — ALFC requires root access to `/proc/acpi/call` and runs as a system service (systemd/OpenRC). Flatpak's sandbox fundamentally blocks both. All comparable hardware control tools (CoreCtrl, nbfc-linux, TLP) avoid Flatpak for the same reasons.
