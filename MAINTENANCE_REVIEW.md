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

| Finding                              | Reproduction and result                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stale mainline guidance              | Root instructions, README, roadmap, security and protocol links still described PR #1 as under review. Updated mainline instructions; preserved historical audit hashes and failures.                                                                                                                                                                           |
| Foreign Linux installation ownership | Isolated systemd/OpenRC removal with a foreign launcher symlink still stopped/disabled the service and deleted files. Removal now rejects before those mutations; regression exercises both init systems.                                                                                                                                                       |
| Web curve deletion focus             | Removing the focused row button lost keyboard position in Chromium. The regression failed before the fix; focus now moves to the next remaining temperature field, or the preceding row at the end.                                                                                                                                                             |
| ACPI hexadecimal dispatch            | The native adapter accepted uppercase `0X` IDs, but upstream `acpi_call` recognizes lowercase `0x` and otherwise uses decimal parsing. Getter/setter regression failed before normalization and passed after it.                                                                                                                                                |
| Desktop resource permissions         | Isolated install under `umask 077` left optional desktop resources unreadable to the desktop user. Installation now normalizes owned resource/script permissions while preserving existing configuration.                                                                                                                                                       |
| Plasma authoritative-field drafts    | A dirty fixed-percentage field stayed at 63 after the backend changed that same authoritative field to 72. Per-field tracking now refreshes changed fields, including focused inputs, while preserving unrelated drafts.                                                                                                                                        |
| Plasma editor keyboard focus         | Removing a focused curve row lost focus in the original QML. Deferred focus now selects the next remaining temperature field; insertion also focuses its new point.                                                                                                                                                                                             |
| Omarchy endpoint changes             | A QML binding-order race could leave a retry pending after an invalid endpoint change. The transport revalidates the endpoint directly before reconnecting or opening a socket.                                                                                                                                                                                 |
| Integration platform boundary        | The test entrypoint replaced Linux adapters only. It now rejects other platforms before any native initialization; a simulated Windows execution verifies the early failure.                                                                                                                                                                                    |
| Qt integration teardown              | Final rerun exposed a child requiring forced termination. Replaced cross-thread stdin/quit with a GUI-thread notifier and explicit QML-engine destruction; retained natural-exit assertions and original error diagnostics. The two scenarios then passed ten consecutive repetitions (20 executions).                                                          |
| Cloud runtime and preview setup      | The cloud checkout initially exposed Bun 1.4.0 and its setup lacked a version preflight. Tracked setup/run/check now validate exact tested pins; stale Bun/Node negative controls fail clearly. The preview serves Vite as a normal user, with the elevated backend started separately.                                                                         |
| Installed AUR documentation          | Archive documentation passed, but the actual AUR staging function placed runtime sources elsewhere than the docs. Two new Omarchy source links were therefore missing in installed docs. They now link to merged-mainline source; the real staged AUR documentation is checked separately.                                                                      |
| Required CI root setup               | The first real component CI run failed before installing Qt because its minimal chroot had no `/proc` backing `/dev/fd`. Setup now mounts and reliably unmounts that process filesystem, and reads the package manifest through a pipeline; component failures remain fatal.                                                                                    |
| Windows token fixture startup        | A rerun timed out at 15.006 seconds after a previous 12.591-second pass during broader runner slowdown. Independent reference/Bun probes now run concurrently with individual 20-second process deadlines, sibling cancellation and labelled failures. Exact boolean token equivalence remains required; the outer 25-second budget allows bounded diagnostics. |
| Standalone widget notice             | The standalone `.plasmoid` zip included only the applet tree, while the project copyright/permission notice lived outside it. The installable tree now carries an unchanged copy of the MIT notice, so both standalone and full archives retain it.                                                                                                             |
| Missing required component tier      | Qt-only jobs legitimately omitted Plasma editor cases. Added a separate matching distro component tier; Qt-only optional skips remain distinct from installed-plugin failures.                                                                                                                                                                                  |

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

## First maintenance pass automated execution

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

Remote validation is visible in [PR #15’s checks](https://github.com/ThatMarko/alfc/pull/15/checks) and the
[CI workflow](https://github.com/ThatMarko/alfc/actions/workflows/ci.yml). The
Windows job compiles WmiDll with MSVC and executes the real COM/integer-decoder
harness plus Windows-only batch cases. Treat that job’s actual conclusion as
Windows evidence; the local Linux results above never establish it.

## Second deep pass

A fresh review of PR #15 started at `81172b8f1071c49d6d15e1b6979a6fcab2063887`.
Remote `master` still pointed to the merged revision recorded above. Reviewers
changed areas to examine the implementation independently. The following
regressions reproduced failures before their fixes:

| Finding                          | Reproduction and corrected behavior                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fan monitoring backlog           | A held ACPI read in fixed mode accumulated twelve timed-out reads in one minute and three periodic reinitializations in fifteen minutes. Releasing the real native queue exposed the burst. Monitoring now tracks the actual unresolved read independently of its consumer deadline, and permits one outstanding maintenance sequence. Recovery resumes current work without replaying the backlog; no OS-call cancellation is implied. |
| Pending web form focus           | Submitting with Enter disabled the focused Apply control and left focus on the document. Focus now returns after completion or error only when the user has not navigated elsewhere, including overlapping form operations.                                                                                                                                                                                                             |
| Plasma clock correction          | Moving the wall clock backward kept old telemetry fresh and postponed command/heartbeat deadlines. Future-dated readings are stale and the next clock check retires the session and pending commands without replay.                                                                                                                                                                                                                    |
| Literal Plasma diagnostics       | Real Kirigami messages interpreted backend tags and paths as markup and collapsed whitespace. Escaped pre-wrap formatting now preserves literal tags, ampersands, line breaks and repeated spaces; a native component regression inspects the displayed document.                                                                                                                                                                       |
| Omarchy stalled handshake        | A real TCP peer accepted the connection without completing WebSocket negotiation. The Open-only watchdog never ran. The connection timer now covers Connecting, with a ten-second handshake bound and backward-clock recovery. The ephemeral fixture owns and cleans up its sockets and threads.                                                                                                                                        |
| Omarchy removal ownership        | When a parent prevented removing the empty module directory, removal discarded its marker and made later installation reject the leftover directory. Failed directory cleanup now restores the ownership marker for retry/reinstallation.                                                                                                                                                                                               |
| Linux installation paths         | Isolated systemd/OpenRC fixtures showed destination symlinks redirecting writes outside the installation. Preflight now rejects redirected roots, executable/helper/configuration/service paths before service mutations. Incorrect required source path types also fail before mutation.                                                                                                                                               |
| Linux optional resource upgrades | Upgrading from a release with desktop resources to one omitting them left stale installed integrations. Owned omitted resources are retired; existing service definitions also receive explicit readable/executable permissions under restrictive initial modes.                                                                                                                                                                        |
| AUR stop failure                 | A successful disable operation overwrote the failed stop status in the removal scriptlet. The scriptlet now returns immediately on stop failure. This does not claim that pacman necessarily aborts the package transaction.                                                                                                                                                                                                            |

The existing web insertion focus contract was confirmed by its regression and
preserved. Backend HTTP/listener/origin/persistence review and independent
Windows worker/NativeAOT and Linux RAPL review found no additional reproducible
defect. A suspected numeric-method newline bypass was disproved. The old
fan-controller timeout fixture now settles its held native operation when it
simulates recovery, preserving its fixed-speed outcome assertion while testing
the real distinction between consumer timeout and transport completion.

Fresh combined verification for this pass:

- Frozen Bun 1.4.3 installation and live audit passed; 293 packages had no
  reported vulnerabilities. Node 24.22.0 ran the checked development tools.
- ESLint, strict frontend/server/integration TypeScript, 359 Linux tests across
  26 Vitest files, and both production builds passed. Twelve Windows-only cases
  remain explicitly skipped locally and must execute in the Windows CI job.
- All 19 Chromium scenarios passed, including pending-focus success, error,
  deliberate navigation and overlapping-operation coverage.
- Matching Qt 6.8.2 / Plasma 6.3.5 / Kirigami 6.13 passed 85 checks without
  skips. Explicit Qt-only 6.12 passed 62 checks with 23 component skips.
- Omarchy passed 21 transport/component checks without skips on both native
  Qt 6.8.2 and PySide Qt 6.12, plus eight isolated installer checks.
- Both production web/QML integration scenarios passed with natural process
  cleanup. Portable C++ output packing compiled with warnings as errors and
  passed; Python/shell syntax and source Markdown checks passed.

Full desktop sessions and physical-device behavior remain the manual gates above.

Final-commit CI is linked from [PR #15](https://github.com/ThatMarko/alfc/pull/15/checks).
Local fixture results do not substitute for Windows MSVC/COM execution or the
separate full desktop and physical release gates.

## Third peer review

The 2026-10-16 peer review started at PR #15 head
`432cba5e0e559fd8e6378d2b0073a754464bc9df`, with remote `master` unchanged.
Reviewers rotated across frontend, server, fan control, desktop clients and
packaging. Confirmed failures were reproduced before their fixes:

| Finding                       | Reproduction and corrected behavior                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mode-button focus             | A successful keyboard mode change left its button disabled even after the pending operation finished, so restoring focus failed. Selected mode buttons now remain focusable; reactivating the selected mode sends no request. Capability, connection and pending gates remain.                                                                                                                                  |
| Rapid fan-mode transitions    | Entering Fixed and returning to Auto between two sampling ticks retained old cooling history, or the startup-only direct target path. Real native-queue fixtures reproduce premature output reduction. Manual fan operations now retire that history, and regressions verify 29 fresh cooling cycles hold the acknowledged 90% output before the 30th cycle steps to 52%.                                       |
| Settings permissions          | A real production save under umask `022` replaced a `0600` configuration with `0644`. Atomic persistence now preserves existing POSIX permission bits, defaults missing settings to `0600`, and normalizes stale temporary-file permissions before writing. Stat/chmod failures preserve the prior configuration and report failure. Windows content/cleanup checks remain separate from POSIX mode assertions. |
| Web initial settings deadline | A WebSocket that opened but withheld its initial settings remained unready after 120 simulated seconds. The provider now retires it after ten seconds, preserves retained settings/drafts and reconnects without replay. A valid snapshot cancels that socket's deadline; invalid snapshots cannot extend it.                                                                                                   |
| Plasma readiness deadlines    | A real accepted TCP connection could stay Connecting past eleven seconds, and an Open connection supplying pongs without settings also stayed unready. Separate ten-second handshake and initial-snapshot phases now bound these states. Owned native/PySide TCP fixtures cover recovery and cleanup without a desktop shell.                                                                                   |
| Plasma response metadata      | A malformed success/error carrying the widget's own request ID could complete a pending operation despite non-string method metadata. Reply validation now matches the web client's envelope guard. Valid replies with omitted optional metadata and exact large numeric strings still complete correctly.                                                                                                      |
| Omarchy response budget       | A valid 65,536-byte fan-table request produces a 65,734-character state snapshot, which the old 65,536-unit response cap discarded. The bounded input ceiling is now 1,048,576 UTF-16 units; real sockets verify the larger valid snapshot and rejection above the new ceiling. This response budget is separate from the request limit.                                                                        |
| Windows wrapper notice        | Both Windows builders bundled WinSW 2.12.0 without its copyright/permission notice. The exact pinned upstream notice is now staged beside the wrapper by both builders, retaining the separate ALFC license. The actual release assembly was exercised with disposable executable/DLL fixtures; local batch execution is not claimed.                                                                           |

The independent native review found no further reproducible worker, NativeAOT,
ACPI or RAPL defect; 101 focused native checks passed. Omarchy ownership,
clock/session handling and user-configuration preservation remained correct.
The browser's native Connecting-phase timeout was not measured, so this review
does not claim a ten-second browser handshake bound. No physical hardware or
full desktop-session result follows from these fixtures.

Fresh combined checks passed frozen installation, the live dependency audit,
lint, strict workspace/integration types, 366 Linux tests across 27 Vitest files
(12 Windows-only skips), both production builds, all 22 Chromium scenarios and
both real production web/QML integration scenarios. Portable C++ output packing,
Python/shell syntax, source Markdown links and workflow validation also passed.
The whole matching Qt 6.8.2 / Plasma / Kirigami tier passed 93 checks without
skips; explicit PySide Qt 6.12 passed 70 with 23 component skips. Qt 6.12 can
coalesce repeated Connecting status transitions, so retry activation explicitly
arms the deadline; its regression counts actual accepted TCP connections.
Omarchy passed 22 checks without skips on both Qt runtimes, plus eight isolated
installer checks.
The Qt and final-commit CI evidence remains available in
[PR #15's checks](https://github.com/ThatMarko/alfc/pull/15/checks); the required
component tier must execute without optional skips, and Windows MSVC/COM/batch
evidence comes from its actual Windows job.
