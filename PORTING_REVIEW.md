# PR #1 implementation and documentation audit

This audit applies to `feat/wmi-ffi`, the branch for
[PR #1](https://github.com/ThatMarko/alfc/pull/1). It covers implementation,
client parity, packaging, documentation, and evidence limits. A package version,
passing fixtures, or a native compile does not certify physical laptop support.

## Scope and review method

The audit began from the 169-file tracked inventory at `d8b95ec`. Every tracked
text file was read, including tests, scripts, manifests, workflows, configuration,
and all 18 Markdown documents. Images/icons were inspected visually and through
metadata; the vendor DLL was inspected through PE/CLR metadata and its managed
API/dependencies. The complete lockfile was parsed, checked against workspace
manifests, installed frozen, and audited against registry advisories. New source
and regression files were reviewed as part of their owning component. The review
ledgers cover all 176 resulting files, with no uncovered paths.

| Area            | Reviewed scope                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Root            | Documentation, manifests/lock, compiler/lint/test configuration, issue templates, setup metadata, license, screenshot       |
| Backend/shared  | Every common catalog/type/guard, fan controller, persistence module, WebSocket handler, and associated test                 |
| HTTP/deployment | Entrypoint, permission checks, loopback serving, runtime paths, builds, bootstrap/AUR scripts, CI/releases, deployment docs |
| Web             | Every React component/hook/helper, static asset, configuration, unit test, and browser scenario                             |
| Widget          | Every QML/JS component, metadata/configuration, install helper, Qt test/runner, and widget guide                            |
| Native          | All Linux/Windows adapters and workers, C++ COM/packing code, C# exports/projects/tests, and shipped SDK metadata           |

The docs were checked against code rather than treated as an implementation
specification. Obsolete helper-process claims, universal Windows-version claims,
unsafe power-limit assurances, unmeasured performance comparisons, and claims of
LAN access were removed. Historical model reports are explicitly separated from
current-binding certification. Community conduct policy and attribution remain
intact, with project/reporting links clarified.

## Corrected contracts and defects

- Current clients require protocol 1.1 request IDs within major 1. The server
  retains legacy requests without IDs. Full snapshots, optional capability
  flags, telemetry, and errors are documented in
  [PROTOCOL.md](common/PROTOCOL.md) and [COMPATIBILITY.md](common/COMPATIBILITY.md).
- Commands are globally ordered across loopback listeners. State follows
  hardware acceptance where required; a save failure reports `PERSISTENCE_ERROR`
  and broadcasts the active state. Shutdown-time errors preserve correlation,
  and malformed object-valued message kinds receive a structured error.
- CPU/GPU curve drafts and PL1/PL2 drafts survive updates to other settings.
  Floating-point row insertion cannot create duplicate thresholds. Web tooltips
  are keyboard-accessible, narrow layouts are exercised in Chromium, and widget
  error/restart guidance remains visible with fresh telemetry.
- Fixed fan recovery retries unknown writes even while temperature reads fail.
  Cooling counters are reset appropriately. Targets and unconfirmed output are
  distinct; both clients mark telemetry stale after ten seconds.
- Automatic startup uses the highest configured fan target until temperatures
  are known, then applies the measured curve target on its first valid collection.
  It no longer lowers a hot laptop's fans before reading its temperatures.
- Linux output widths/ranges follow the shared catalog. Windows IDs, names,
  integer variants, parameter qualifiers, and output widths are validated. Large
  packed values use exact decimal strings.
- WMI uses one owning COM worker and CPU tuning uses another. Unexpected worker
  exit, uncertain COM completion, and failed power rollback disable the affected
  channel with restart guidance. Initialization/cleanup races and late queued
  CPU work cannot reopen or use closed native state.
- Source-production paths differ from compiled resource paths independently of
  `NODE_ENV`. Compiled Windows workers are explicit build entrypoints. Both
  loopback listeners share broadcasts and close together; a stop exception does
  not skip the other listener or BIOS restoration.
- Windows service tags use WinSW's actual element names. Elevation checks do not
  depend on the optional LanmanServer service. Linux upgrade/removal refuses to
  proceed after a failed service stop, preserves settings, and protects another
  installation's command link. Local tar creation uses separate staging.

## Toolchain and repeatable checks

Bun 1.4.3 was confirmed as the latest stable npm release during this audit and
is pinned by the package manager and workflows. Node.js 24 runs development
tooling; production executables embed Bun. Vitest 5.0.4 and lint-staged 17.6.0
replace the vulnerable older toolchain. The unused deletion dependency was
replaced with exact workspace cache deletion, and source-map-js was patched.
No advisory was suppressed.

```bash
bun install --frozen-lockfile
bun audit
bun run all-checks
bunx playwright install chromium
bun run test:web
c++ -std=c++17 -Wall -Wextra -Werror \
  server/native/windows/wmidll/WmiOutput.test.cpp -o /tmp/alfc-wmi-output-test
/tmp/alfc-wmi-output-test
dotnet run --project server/native/windows/cpuoc-dotnet/CPUOC.Tests.csproj
```

Browser tests use controlled backend messages in real Chromium. Outside CI an
installed `/usr/bin/chromium` is used automatically; set
`ALFC_CHROMIUM_EXECUTABLE` for another binary. They supplement checks against an
actual running backend rather than replace them.

For Qt tests, use a separate development environment:

```bash
python3 -m venv /tmp/alfc-qt
/tmp/alfc-qt/bin/python -m pip install PySide6==6.8.2.1
/tmp/alfc-qt/bin/python plasmoid/run_qml_tests.py
```

Full editor/layout tests require compatible Plasma/Kirigami modules. Qt-only CI
reports those missing modules as explicit skips. Linked EGL/GL libraries and Qt
Quick software rendering are required by the headless setup. See
[plasmoid/DEPENDENCIES.md](plasmoid/DEPENDENCIES.md). This is not a full Plasma
shell session.

Linux CI also runs C++ packing and C# export fixtures. Windows CI builds the
actual WMI DLL with MSVC and executes the COM completion/integer-decoder harness
without a firmware provider. [RELEASING.md](RELEASING.md) describes complete
archives and the distinction between standard and experimental CPUOC packaging.

## Experimental Windows CPU tuning boundary

The shipped `IntelOverclockingSDK.dll` is managed AnyCPU .NET Framework 4
assembly version 6.5.0.114, SHA-256
`4d0fc01b076fd59ea3e19c82f82be8c200e2903abc713becee30dbb4b2cc1e98`.
Its metadata/code references WCF named-pipe services, the XTU Windows service,
SQL Server CE, and Intel companion assemblies absent from this project.

Actual source compilation against that assembly succeeds, but that does not
establish deployment. Cross-OS Windows NativeAOT compilation is unsupported;
a separate native-compiler dependency-closure probe also failed on missing
`System.Data.SqlServerCe`. Therefore the project explicitly gates publish behind
`AllowExperimentalCpuocPublish=true`, and normal Windows archives omit CPUOC.
The flag is for investigation, not a workaround proving compatibility.

Controlled export fixtures verify initialization, real-time tunability,
application/readback, both rollback attempts, and permanent failure after an
unverifiable rollback. Real XTU/driver execution remains unverified. A deployable
replacement needs a supported runtime boundary and complete licensed dependencies.
NativeAOT libraries cannot be explicitly unloaded; their owning worker remains
loaded until process exit.

## Verification results

- Frozen installation, ESLint, strict TypeScript, and both workspace builds pass.
  Vitest executes 21 files: 290 tests pass on Linux and one Windows-only effective
  token test is explicitly skipped there. That test runs on Windows CI.
- All 13 Chromium scenarios pass, covering authoritative state, independent
  drafts, correlated failures, reconnect/no replay, capability changes, invalid
  versions, stale activity, exact raw values, tooltips, and a 320px layout.
- All 55 Qt checks pass with matching Plasma/Kirigami modules. Qt-only execution
  passes 47 and explicitly skips eight Plasma editor cases. A broken installed
  Plasma plugin is a failure, not an unavailable-module skip.
- Portable C++ packing checks and the strict MinGW Windows DLL compile/link pass.
  The C# native-export regression project passes against its controlled SDK;
  actual source also compiles against the shipped legacy SDK. These are not XTU
  hardware or successful NativeAOT publishing results.
- Real Bun source/compiled worker checks, cross-listener networking, runtime
  source-production/compiled paths, startup/shutdown, and seven isolated
  packaging/service regressions pass. The local Linux archive builds without
  containing itself and includes its linked documentation and screenshot.
- Actual packaged and source-production backends serve the UI through
  `localhost`, `127.0.0.1`, and `::1`. Chromium confirms that unavailable-hardware
  controls match state and correlated native errors settle their own request.
- The live registry audit reports no advisories after the toolchain changes.
  This is a point-in-time result, not a promise about future advisories.

Tests using controlled native fixtures do not access real firmware or Intel
drivers. Review the CI run associated with the audit commit on PR #1 for actual
Linux/Windows outcomes, including MSVC and the Windows COM regression executable.

## Authoritative grounding

- [Bun compiled workers](https://bun.com/docs/bundler/executables#worker),
  [Workers](https://bun.com/docs/runtime/workers),
  [FFI](https://bun.com/docs/runtime/ffi),
  [WebSockets](https://bun.com/docs/runtime/http/websockets), and installed
  `bun-types` declarations: bundling, ownership, close events, pointer lifetimes,
  backpressure, explicit loopback binding, and `stop(true)`.
- [Bun audit](https://bun.com/docs/pm/cli/audit): read-only audit versus intentional
  fixes, with installed Vitest/lint-staged manifests for Node requirements.
- [React](https://react.dev/reference/react/useEffect), installed
  `react-use-websocket`/Reactstrap APIs, and
  [WAI tooltips](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/): event delivery,
  cleanup, request replay prevention, keyboard and descriptive associations.
- [Playwright WebSocket routing](https://playwright.dev/docs/api/class-websocketroute):
  controlled protocol scenarios alongside actual backend smoke checks.
- [Microsoft WMI](https://learn.microsoft.com/en-us/windows/win32/wmisdk/calling-a-method)
  and its `IWbemCallResult` documentation: asynchronous completion, output
  variants, parameter IDs, and COM ownership.
- [NativeAOT libraries](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/libraries)
  and [limitations](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/):
  unsupported unloading, dynamic dependency limits, and publishing requirements.
- [Linux acpi_call](https://github.com/nix-community/acpi_call),
  [powercap](https://docs.kernel.org/power/powercap/powercap.html), and
  [WinSW v2.12 documentation](https://github.com/winsw/winsw/tree/v2.12.0/doc):
  response encoding, RAPL constraints, and exact service XML names.
- [Qt JavaScript](https://doc.qt.io/qt-6/qtqml-javascript-hostenvironment.html),
  [WebSocket](https://doc.qt.io/qt-6/qml-qtwebsockets-websocket.html),
  [Canvas](https://doc.qt.io/qt-6/qml-qtquick-canvas.html), and installed Plasma
  modules: actual URL, reconnect, rendering, and layout behavior.

When documentation sites were blocked, official upstream source and installed
declarations were used. Vendor SDK inspection establishes its contract and
missing dependencies, not driver compatibility.

## Remaining physical release gates

1. Exercise fan, temperature, and supported GPU calls on compatible Windows and
   Linux hardware, including multi-argument methods and driver failures.
2. Verify BIOS control during service stop and OS shutdown, and power-limit
   readback/rollback with the actual Intel driver.
3. Run the complete widget on the oldest supported and a current Plasma 6
   desktop, including panel/tray/desktop contexts and accessibility.
4. Soak-test simultaneous web/widget clients through backend restarts and
   measure latency, CPU use, and power on real hardware.

A JavaScript watchdog cannot cancel firmware, kernel ACPI, or a native driver
call already executing. Hardware recovery and BIOS handoff cannot be guaranteed
for a hung device. No timing comparison here is a physical performance benchmark.
