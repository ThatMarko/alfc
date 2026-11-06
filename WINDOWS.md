# ALFC on Windows

This guide installs, runs, upgrades and removes ALFC on Windows. Read the
[hardware notes](README.md#hardware-and-platform-support) first: ALFC changes
firmware fan settings, and no laptop model is certified. Everyday operation
and troubleshooting shared with Linux is in [OPERATIONS.md](OPERATIONS.md).

## Requirements

| Requirement                                   | Why                                                                                                                                                                        |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 64-bit (x64) Windows 10 version 1809 or later | Releases contain only an x64 build, and the embedded Bun runtime requires Windows 10 version 1809 or later.                                                                |
| A compatible Gigabyte Aorus/Aero laptop       | ALFC uses the laptop's vendor WMI interface (`GB_WMIACPI_Get` / `GB_WMIACPI_Set` in the `root\WMI` namespace).                                                             |
| The vendor WMI provider and drivers           | They come with the laptop's own Gigabyte software and drivers. ALFC does not install or repair them. Do not apply registry or driver instructions meant for another model. |
| Administrator rights                          | The backend talks to firmware. The scripts ask for elevation through User Account Control (UAC) when needed.                                                               |
| A modern browser                              | For the web UI at `http://localhost:5522`.                                                                                                                                 |

You do **not** need to install Bun or Node.js: `alfc.exe` embeds Bun.

CPU power-limit tuning is **not** available in the standard Windows archive.
The optional CPU-tuning component (CPUOC) and the proprietary Intel SDK it
depends on are an unverified experimental prototype and are left out on
purpose; see [RELEASING.md](RELEASING.md#windows-cpu-tuning-is-experimental).
Fan control and GPU boost do not depend on it. Plasma and Omarchy integrations
are Linux-only; on Windows, use the web UI.

Stop other fan-control software that writes the same controls before
starting ALFC.

## Download and prepare

1. From the [GitHub releases page](https://github.com/ThatMarko/alfc/releases),
   download `alfc-vX.Y.Z-windows-x64.zip` and `SHA256SUMS` from the same
   release.
2. Check the archive's checksum in PowerShell and compare it with the matching
   line in `SHA256SUMS`:

   ```powershell
   Get-FileHash .\alfc-vX.Y.Z-windows-x64.zip -Algorithm SHA256
   ```

3. Extract the zip to the folder ALFC will run from. The service runs from
   this folder and saves its settings here, so choose a permanent location
   that standard users cannot modify, for example a folder under
   `C:\Program Files`.

The extracted folder contains:

| File or folder                                              | Purpose                                                                                            |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `alfc.exe`                                                  | The backend, with Bun embedded                                                                     |
| `WmiDll.dll`                                                | Native helper for the vendor WMI interface                                                         |
| `frontend\`                                                 | Web UI files served by the backend                                                                 |
| `alfc.config.json`                                          | Settings; see [Configuration](OPERATIONS.md#configuration)                                         |
| `install.bat`, `uninstall.bat`, `run.bat`                   | Service install, service removal, temporary run                                                    |
| `alfc-service.exe`, `alfc-service.xml`, `WinSW-LICENSE.txt` | The [WinSW](https://github.com/winsw/winsw) v2.12.0 service wrapper, its configuration and license |
| `*.md`, `common\`, `plasmoid\`, `aur\`, `assets\`           | Documentation                                                                                      |
| `omarchy\`, `plasmoid\package\...\Protocol.js`              | Linux-only Omarchy module files; unused on Windows                                                 |

Keep these files together. The installer refuses to continue if `alfc.exe`,
`alfc-service.exe`, `alfc-service.xml`, `WmiDll.dll` or
`frontend\index.html` is missing.

Review `alfc.config.json` before the first start. Startup applies the saved
fan mode and GPU boost setting automatically.

## Try it without installing a service

Run `run.bat` from an administrator terminal (or double-click it and approve
UAC, which opens a separate elevated window that closes when `alfc.exe` exits):

```text
Starting ALFC fan control (temporary, non-service mode)...
Press Ctrl+C to stop.
Open http://localhost:5522 after the server reports startup finished.
```

Wait for `[Server] Start finished - UI available @ http://localhost:5522`,
then open that address. Press **Ctrl+C** to stop; ALFC attempts to hand fan
control back to the BIOS before exiting. Do not run `run.bat` while the service is running:
only one copy can own port 5522, and the second one exits without touching the
hardware.

## Install the service

Run `install.bat` from an administrator terminal so all messages stay visible
(double-clicking opens an elevated window that closes on completion and on
early preflight errors). The installer:

1. checks that the required files are present and that `alfc-service.xml` uses
   service ID `alfc`;
2. checks whether an `alfc` service already exists and, if so, that it was
   installed from **this** folder;
3. stops an existing service and waits until it has stopped, then removes
   it;
4. installs the service with WinSW and starts it.

It finishes with:

```text
Service started. ALFC may still be initializing.
Open http://localhost:5522 once startup finishes.
Check alfc-service.out.log if the UI is not available yet.
```

The service is named **Aorus Laptop Fan Control** (service ID `alfc`). It
starts automatically with a delayed start after boot. If it crashes, Windows
restarts it after 10, 20 and then 30 seconds; the failure count resets after
an hour.

To stop, start or restart it, use the Services app (`services.msc`) or an
administrator PowerShell:

```powershell
Restart-Service alfc
Get-Service alfc
```

When the service stops, WinSW sends Ctrl+C and waits up to 15 seconds. ALFC
uses at most 12 of them to finish pending work and hand fan control back to
the BIOS.

## Configuration changes

Change settings in the web UI; they are saved immediately. To edit
`alfc.config.json` by hand, stop the service, back up and edit the file in the
installation folder, then start the service. See
[OPERATIONS.md](OPERATIONS.md#configuration) for the fields.

## Upgrade or move to a new release

Each release is a self-contained folder, and the service is tied to the folder
it was installed from. The installer will not take over a service registered
from another folder. To upgrade:

1. In the **old** folder, run `uninstall.bat`. It stops and removes the
   service but keeps all files, including `alfc.config.json`.
2. Extract the new release to a new folder.
3. Copy `alfc.config.json` from the old folder into the new one, replacing the
   default file. The scripts do not copy settings for you.
4. In the **new** folder, run `install.bat`.
5. Once the new version works, delete the old folder.

Running `install.bat` again in the **same** folder simply reinstalls the
service from that folder and keeps its configuration.

## Uninstall and remove settings

Run `uninstall.bat` from the installation folder and approve the UAC prompt.
It stops the service, waits for it to stop, and removes it. Configuration,
logs and release files stay in place, and the script ends with
`Done. You can delete the alfc folder now.`

To remove everything, including your settings and logs, delete the folder
after uninstalling. Running `uninstall.bat` again when the service is already
gone is safe; it reports that the service is absent.

If stopping the service fails, the script aborts without removing anything, so
the service is never deleted while ALFC might still be controlling the fans.

## Logs

The service writes the backend's output beside `alfc.exe`:

- `alfc-service.out.log`: normal progress, including `Start finished`;
- `alfc-service.err.log`: errors and warnings;
- `alfc-service.wrapper.log`: WinSW service-wrapper events and stop/start status.

WinSW rotates `out.log` and `err.log` at 10 MiB and keeps eight rolled files
for each; `wrapper.log` is not rotated. A temporary `run.bat` session prints
to its own window instead.

## Troubleshooting

| Problem                                                                                | What to do                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Missing required release file: ...` or `Required release file is a directory: ...`    | The folder is incomplete. Extract the whole zip again.                                                                                                                                                                                                  |
| `The existing alfc service belongs to another executable. Use its own uninstaller ...` | The service was installed from a different folder. Run `uninstall.bat` in that folder first, then follow [Upgrade or move](#upgrade-or-move-to-a-new-release).                                                                                          |
| `Unable to query the ALFC service. No service was changed.`                            | `sc.exe query alfc` failed for a reason other than "service does not exist". Check the service in `services.msc`, then retry.                                                                                                                           |
| `The WinSW configuration must use service ID alfc.`                                    | `alfc-service.xml` was edited or replaced. Restore the file from the release zip.                                                                                                                                                                       |
| `Failed to install service.` or `Failed to start service.`                             | Check `alfc-service.wrapper.log` and `alfc-service.err.log`. If `services.msc` is open while reinstalling, close it so Windows can finish deleting the previous service registration, then retry.                                                       |
| The installer or uninstaller stops after "Stopping ..."                                | The running service did not stop. Nothing was removed. Check `alfc-service.wrapper.log` and `alfc-service.err.log`, then retry.                                                                                                                         |
| Startup pauses at `[Native] Initializing WMI...` or logs `wmiInit timed out`           | WMI did not respond within the 20-second startup limit; ALFC then finishes starting with fan control unavailable and shows the restart warning. A reboot often clears a wedged WMI service.                                                             |
| `WMI init attempt ... failed` or "Fan control is not available on this system"         | Check that the vendor WMI classes exist. In PowerShell, run `Get-CimClass -Namespace root/WMI -ClassName GB_WMIACPI_Get`. An error means the provider is missing; it comes from the laptop vendor's drivers and software. Restart ALFC after fixing it. |
| CPU tuning is shown as unavailable                                                     | Expected with the standard archive.                                                                                                                                                                                                                     |
| "This needs to be run with elevated privileges."                                       | `alfc.exe` was started directly without administrator rights. Use `run.bat` or the service.                                                                                                                                                             |
| Startup fails with an address-in-use error                                             | Another ALFC already owns port 5522 (often the service while you use `run.bat`). Stop one of them.                                                                                                                                                      |

More symptoms are listed in [OPERATIONS.md](OPERATIONS.md#troubleshooting).

## Developing on Windows

Source development uses Bun and Node.js from [CONTRIBUTING.md](CONTRIBUTING.md).
Run the frontend as a normal user and the backend in an **administrator**
terminal:

```powershell
bun run --cwd frontend start    # web UI on http://localhost:3000
bun run --cwd server start      # backend on port 5522, in an administrator terminal
```

Building `WmiDll.dll` (`bun run --cwd server build:wmidll`) and the full
release (`build.bat`) require an x64 MSVC developer shell. `build.bat` also
needs the WinSW v2.12.0 x64 wrapper saved as
`bootstrap/scripts/alfc-service.exe`. See [RELEASING.md](RELEASING.md).

## What is verified on Windows

Windows CI builds `WmiDll.dll` with MSVC, runs its COM tests against
substitutes, and runs the real batch scripts against stand-in commands for
UAC, the Service Control Manager and WinSW. Real UAC prompts, real service
registration, the vendor WMI provider on a laptop, and the BIOS handoff are
manual release checks, not automated results.
