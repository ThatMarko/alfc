# Releasing ALFC

## How to create a release

1. Update the version in `package.json` and `plasmoid/package/metadata.json`
2. Commit: `git commit -am "chore: bump version to X.Y.Z"`
3. Tag: `git tag vX.Y.Z`
4. Push: `git push origin master --tags`

The GitHub Actions release workflow will:

- Build Linux (x64) and Windows (x64) on their respective runners
- Run `bun run all-checks` (lint, typecheck, test, build) on Linux
- Compile `WmiAPI.dll` via .NET 8 NativeAOT on Windows
- Download WinSW service wrapper
- Assemble release archives
- Create a **draft** GitHub Release with all artifacts

Review the draft release, edit the notes if needed, then publish it.

## Release artifacts

| Artifact                       | Contents                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `alfc-vX.Y.Z-linux-x64.tar.gz` | Server binary, frontend, service scripts, plasmoid, config, LICENSE          |
| `alfc-vX.Y.Z-windows-x64.zip`  | Server binary, frontend, WmiAPI.dll, service scripts, WinSW, config, LICENSE |
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

### Planned

- **KDE Store** (store.kde.org) — The `org.kde.alfc.plasmoid` file can be uploaded to the KDE Store so Plasma users can discover and install the widget directly from KDE Discover. The backend still needs to be installed separately from GitHub Releases.
- **AUR** (Arch User Repository) — Arch Linux has the highest KDE Plasma user density. An AUR package (`alfc`) would provide native package management for Arch users.

### Not viable

- **Flatpak** — ALFC requires root access to `/proc/acpi/call` and runs as a systemd service. Flatpak's sandbox fundamentally blocks both. All comparable hardware control tools (CoreCtrl, nbfc-linux, TLP) avoid Flatpak for the same reasons.
