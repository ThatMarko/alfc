# Releasing ALFC

## Validate the source revision

Use Bun 1.4.3 or newer and Node 24. Run `bun install --frozen-lockfile`,
`bun run all-checks`, and the documented browser and Qt runtime checks before
creating a tag. CI runs the shared checks on Linux and Windows, browser/Qt checks
on Linux, and builds the Windows WMI DLL with MSVC. Native SDK substitute tests
verify export behavior; they do not establish production Intel SDK compatibility.
Windows CI also runs the actual COM completion and integer decoder regression
without a firmware provider or elevation.
Record physical laptop models and OS versions tested, or explicitly say when
hardware validation was unavailable.

### Why Bun and Node are both in the build environment

Bun installs dependencies, runs the backend/FFI workers, and compiles the server.
Node runs the current Vite, Vitest, and other Node-shebang development CLIs:
`bun run` preserves their shebangs. The current test fixtures also prevent a
simple switch to `--bun`. See [the toolchain explanation](CONTRIBUTING.md#toolchain-and-development)
for the runtime roles and versioned API reference.

Use one Node.js 24 installation, matching both platform workflows. Node 26 was
an upstream-compatible alternative, not a second required installation; ALFC's
declared engine now matches the checked Node 24 workflow. Release users install
neither development runtime: the compiled executable embeds Bun.

Update the version in root `package.json`, `frontend/package.json`,
`server/package.json`, `bootstrap/package.json`, `plasmoid/package/metadata.json`,
and `aur/PKGBUILD` (`pkgver`). Stage the intended files, commit the release change,
then create and push the specific tag from the reviewed revision:

```sh
git tag vX.Y.Z
git push origin vX.Y.Z
```

Avoid publishing every local tag with `--tags`. The workflow validates that the
release tag is a version-shaped `v...` value matching root `package.json`.

## Automated artifacts

`.github/workflows/release.yml` builds Linux x64 and Windows x64 independently,
runs lint/type/tests/build checks on both, builds `WmiDll.dll` on Windows, and
assembles these assets into a **draft** GitHub Release:

| Asset                          | Contents                                                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `alfc-vX.Y.Z-linux-x64.tar.gz` | Executable, frontend, default config, systemd/OpenRC scripts, widget package/helpers, LICENSE, and root/common/widget/AUR Markdown docs  |
| `alfc-vX.Y.Z-windows-x64.zip`  | Executable, frontend, default config, WmiDll.dll, WinSW v2.12.0 x64, service scripts, LICENSE, and the same Markdown documentation paths |
| `org.kde.alfc.plasmoid`        | Zip of `plasmoid/package` for per-user KDE installation                                                                                  |
| `SHA256SUMS`                   | SHA-256 digests of all three distributable artifacts                                                                                     |

The Windows service XML uses WinSW's exact `stopparentprocessfirst` and
`stoptimeout` element names. The 15-second wrapper allowance covers the backend's
12-second bounded shutdown attempt. Review archive contents and checksum entries,
release notes, platform results, and hardware limitations before publishing the
draft. Generated checksums detect asset changes; they are not a detached signature.

WinSW XML names are case-sensitive and deliberately mix naming conventions.
For the pinned **v2.12.0** wrapper, use these exact spellings:

| Setting                         | XML element                  |
| ------------------------------- | ---------------------------- |
| Working directory               | `workingdirectory`           |
| Delayed automatic start         | `delayedAutoStart`           |
| Stop parent before children     | `stopparentprocessfirst`     |
| Stop allowance                  | `stoptimeout`                |
| Log rotation size and retention | `sizeThreshold`, `keepFiles` |

`workingDirectory` is ignored by this parser; `directiory` is a misspelling.
Do not lowercase the valid camelCase names. The current XML matches the
[versioned WinSW parser](https://github.com/winsw/winsw/blob/v2.12.0/src/WinSW.Core/Configuration/XmlServiceConfig.cs).
The regression checks element and attribute names at every nesting depth,
independently of indentation.

Local `./build.sh` assembles `dist/alfc/` and `dist/alfc.tar.gz` without including the
archive inside itself. Run it from any working directory. Local `build.bat`
assembles `dist\alfc\` and `dist\alfc.zip`; it requires an x64 MSVC developer
shell and a separately obtained WinSW v2.12.0 x64 wrapper saved as
`bootstrap/scripts/alfc-service.exe`. Neither script installs a host service.

## Windows CPU tuning is experimental

The published Windows archive and default local archive omit `CPUOC.dll` and the
proprietary `IntelOverclockingSDK.dll`. Fan control and GPU boost do not depend on
that optional CPU tuning channel. The current wrapper remains an unsupported
prototype against a legacy SDK; its dependency closure, NativeAOT compatibility,
and real-hardware behavior have not been established by the substitute test suite.
Do not claim universal Windows 10/11 compatibility or copy SDK binaries into
redistributable release archives.

For explicit local investigation only, the .NET 8 SDK and compatible MSVC/native
build tools are required. `build.bat --experimental-cpuoc` opts into the guarded
publish using `-p:AllowExperimentalCpuocPublish=true`, then includes locally
available CPUOC/SDK binaries in the local archive. The flag acknowledges the
prototype status; it does not establish correctness or redistribution rights.
Keep resulting archives private unless licensing and compatibility are verified.
The NativeAOT library must remain loaded until process exit.

## Distribution follow-up

GitHub Releases are the primary delivery channel. For AUR publication, first verify
the released Linux archive and replace the development `SKIP` checksum in
`aur/PKGBUILD` with the pinned digest. Generate `.SRCINFO`, test on an isolated Arch
system, and follow [aur/README.md](aur/README.md). The AUR package remains unpublished
until that submission is complete.

Upload `org.kde.alfc.plasmoid` to KDE Store only after testing it on the supported
Plasma runtime. The widget does not bundle the privileged backend; describe that
separate requirement clearly. Flatpak packaging would need a separately designed
privileged service interface because the current implementation accesses ACPI and
sysfs directly; it is not an existing distribution target.
