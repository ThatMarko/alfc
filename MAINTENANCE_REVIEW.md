# Merged-mainline maintenance evidence

## Revision and publication state

The 2026-10-15 review started from a clean checkout of remote default branch
`master`, commit `79791f67b7c544b9a9f61e168a88bce5f22fc085`. Remote HEAD was
queried and fetched before implementation. PR #1 is merged. The pre-merge
`ee6ae26` results in [PORTING_REVIEW.md](PORTING_REVIEW.md) remain historical.

GitHub release metadata and remote tags were checked separately. The latest
published release was `v2.0.0-alpha.7`, explicitly a prerelease from before the
merge; alpha.5 and alpha.6 draft records also exist. There is no published stable
2.0.0 release. The official AUR RPC query for `alfc-bin` returned zero results on
2026-10-15 (see [the recorded source](aur/README.md)); the checked-in recipe
remains a development template. This review does not publish it. No release tags, drafts, or public assets are changed
by this maintenance work.

## Toolchain decision

The official [Node release index](https://nodejs.org/dist/index.json) lists
24.22.0 as Krypton LTS and 26.12.0 as Current. CI tests 24.22.0; the supported
engine stays `^24.11.0`. Bun 1.4.3 remains the stable package-manager/runtime pin.
Packaged servers embed Bun and do not need either development runtime installed.

TypeScript remains 6.0.3: typescript-eslint 8.71.2 declares
`>=4.8.4 <6.1.0`, and the TypeScript 7 native compiler does not provide the
legacy compiler API expected by the parser. This is a current toolchain
compatibility constraint, not an assumption that every future compiler is unsafe.
Registry metadata and installed manifests supply the exact peer requirements.

Vitest 5.0.5 fixes cleanup and worker-error handling relevant to the lifecycle
fixtures; [its release notes](https://github.com/vitest-dev/vitest/releases/tag/v5.0.5)
explain the patch. React ESLint 5.27.2 includes cleanup detection corrections;
see the [upstream changelog](https://github.com/Rel1cx/eslint-react/blob/main/CHANGELOG.md).
No engine/peer checks or advisories are suppressed.

## Findings ledger

| Finding                              | Reproduction and result                                                                                                                                                                                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stale mainline guidance              | Root instructions, README, roadmap, security and protocol links still described PR #1 as under review. Updated mainline instructions; preserved historical audit hashes and failures.                                                                                                                  |
| Foreign Linux installation ownership | Isolated systemd/OpenRC removal with a foreign launcher symlink still stopped/disabled the service and deleted files. Removal now rejects before those mutations; regression exercises both init systems.                                                                                              |
| Web curve deletion focus             | Removing the focused row button lost keyboard position in Chromium. The regression failed before the fix; focus now moves to the next remaining temperature field, or the preceding row at the end.                                                                                                    |
| ACPI hexadecimal dispatch            | The native adapter accepted uppercase `0X` IDs, but upstream `acpi_call` recognizes lowercase `0x` and otherwise uses decimal parsing. Getter/setter regression failed before normalization and passed after it.                                                                                       |
| Desktop resource permissions         | Isolated install under `umask 077` left optional desktop resources unreadable to the desktop user. Installation now normalizes owned resource/script permissions while preserving existing configuration.                                                                                              |
| Plasma authoritative-field drafts    | A dirty fixed-percentage field stayed at 63 after the backend changed that same authoritative field to 72. Per-field tracking now refreshes changed fields, including focused inputs, while preserving unrelated drafts.                                                                               |
| Plasma editor keyboard focus         | Removing a focused curve row lost focus in the original QML. Deferred focus now selects the next remaining temperature field; insertion also focuses its new point.                                                                                                                                    |
| Omarchy endpoint changes             | A QML binding-order race could leave a retry pending after an invalid endpoint change. The transport revalidates the endpoint directly before reconnecting or opening a socket.                                                                                                                        |
| Integration platform boundary        | The test entrypoint replaced Linux adapters only. It now rejects other platforms before any native initialization; a simulated Windows execution verifies the early failure.                                                                                                                           |
| Qt integration teardown              | Final rerun exposed a child requiring forced termination. Replaced cross-thread stdin/quit with a GUI-thread notifier and explicit QML-engine destruction; retained natural-exit assertions and original error diagnostics. The two scenarios then passed ten consecutive repetitions (20 executions). |
| Cloud runtime and preview setup      | The cloud checkout initially exposed Bun 1.4.0 and its setup lacked a version preflight. Tracked setup/run/check now validate exact tested pins; stale Bun/Node negative controls fail clearly. The preview serves Vite as a normal user, with the elevated backend started separately.                |
| Missing required component tier      | Qt-only jobs legitimately omitted Plasma editor cases. Added a separate matching distro component tier; Qt-only optional skips remain distinct from installed-plugin failures.                                                                                                                         |

The web review did not reproduce suspected loss of unrelated drafts or unsafe
writes after reconnect: existing snapshot/readiness separation and correlation
checks remain correct. The RAPL review confirmed disabled-zone and rollback
coverage; no change was needed to that contract. Tests now also execute the
permission gate before native/listener traps in both source and compiled builds,
with a granted-token negative control proving the fixture reaches initialization.
Existing correct behavior is retained. No physical fan,
thermal, battery, power, or latency claim follows from fixture execution.

## Reproducible validation boundaries

- JavaScript unit and native-adapter fixtures test validation, queueing, failure
  recovery and persistence with controlled hardware boundaries.
- Chromium protocol scenarios use controlled sockets; the separate cross-client
  harness exercises real production handlers and clients against fake hardware.
- Qt-only protocol/connection tests do not establish Plasma component loading.
  The required distro tier uses matching Qt and KDE components and an explicit
  standalone shell boundary where necessary; it is not a running Plasma session.
- Omarchy support targets the verified stable release and its QML module API;
  the actual Hyprland/Quickshell desktop and laptop firmware remain manual gates.
- Portable packing, managed SDK-substitute checks and Windows MSVC/COM CI prove
  different properties. None establishes a supported CPUOC deployment.

Run `python3 tools/check_docs.py` for source local links/heading anchors, or pass
an extracted release directory to validate packaged Markdown paths. The checker
ignores remote URL availability and fenced placeholder examples. Source links in
the protocol point to the merged default branch.

## Manual release gates

Record the revision, laptop model, firmware, kernel/OS, drivers and desktop
versions with each result:

1. Confirm fan temperature reads, paired writes, supported GPU boost, and RAPL
   application/readback/rollback on the target machines. Verify disabled RAPL
   zones remain disabled. Actual RPM and CPU consumption need measurements.
2. Verify fresh installation, preserved-config upgrade, stop/restart failure,
   removal and explicit purge in disposable target OS installations, including
   real Windows UAC, SCM, WinSW and BIOS handoff during shutdown.
3. Run the full Plasma applet in panel, tray and desktop contexts at narrow
   widths and scaled displays. Exercise keyboard focus, long translated text,
   simultaneous web changes, service restart and destruction/recreation.
4. Run the Omarchy module in its actual supported shell: absent backend at
   login, late startup, restart, suspend/resume, bar reload, repeated install,
   uninstall with unrelated user files, multiple clients and local UI launch.
5. Inspect the exact final archives and digests before any separately authorized
   release or AUR submission. Standard Windows archives must exclude CPUOC/SDK.

## Fresh automated execution

The following were executed during this review, rather than copied from the
pre-merge baseline:

- Frozen installation and live Bun audit passed; no advisories were reported.
- Node 24.22.0 with Bun 1.4.3 passed ESLint, strict workspace and integration
  TypeScript, 343 passing tests across 25 Vitest files, and both production
  workspace builds. Twelve Windows-only cases are explicitly skipped on Linux.
- All 18 Chromium protocol/layout scenarios passed. The new deletion-focus
  regression first failed against the unchanged component.
- Both real web/QML cross-client scenarios passed, using production handlers,
  fake native adapters, real filesystem failure, both loopback families and
  natural child-process cleanup.
- Portable C++ output packing compiled with warnings as errors and passed.
- The matching native Qt 6.8.2 / Plasma 6.3.5 / Kirigami 6.13 widget tier passed
  83 checks without skips. Qt-only 6.12 passed 61 with 22 explicit component
  skips. The actual CMake/Ninja runner and tracked shell-boundary fixtures are
  reproducible tooling rather than a full Plasma session.
- Omarchy installer fixtures passed seven cases; its transport/component runs
  passed 19 checks without skips on both native Qt 6.8.2 and PySide Qt 6.12.
  Desktop-session evidence remains separate.
- Source Markdown links/anchors and staged Linux Markdown paths passed. A
  negative control confirmed the checker rejects links escaping the extracted
  documentation root. The staged archive includes the optional Omarchy module,
  helpers and canonical protocol guard, outside its own archive input tree.

Remote validation is visible in the follow-up pull request’s checks and the
[CI workflow](https://github.com/ThatMarko/alfc/actions/workflows/ci.yml). The
Windows job compiles WmiDll with MSVC and executes the real COM/integer-decoder
harness plus Windows-only batch cases. Treat that job’s actual conclusion as
Windows evidence; the local Linux results above never establish it.
