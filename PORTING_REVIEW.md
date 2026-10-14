# PR #1: Bun, native hardware, and client parity review

This review applies to `feat/wmi-ffi` and records implementation contracts,
repeatable checks, and remaining platform validation for PR #1.

## Runtime and native interfaces

- Bun 1.4.3 is pinned in the package manager, engine floor, and CI/release
  workflows. It was confirmed as the latest stable npm release during review.
- Windows WMI uses `WmiDll.dll` through `bun:ffi`, on one dedicated worker
  thread that owns COM initialization, calls, and cleanup. Optional Intel CPU
  tuning uses a separate worker and queue, so an XTU stall cannot stop fan
  monitoring. JavaScript watchdogs run outside the blocking native threads.
- Worker entrypoints are explicitly bundled in compiled Windows executables.
  Source and compiled worker startup were exercised with Bun.
- WMI DLL ABI version 2 preserves declared output parameter order and byte
  widths, including leading zero bytes in `uint16` results. Rebuild and ship
  `WmiDll.dll` with the server; incompatible versions fail initialization.
- Native arguments use the shared MOF catalog. Linux packing follows declaration
  order rather than JSON property order. Linux checks ACPI setter responses.
- Packed results beyond JavaScript's safe integer range use exact decimal
  strings. Normal temperature and fan sensor values remain numbers.
- Power tuning validates inputs, checks initialization/application results, and
  attempts rollback after a partial failure. RAPL constraints use their names
  where available. The Intel SDK's boolean return values are checked.
- NativeAOT CPUOC libraries and their worker remain loaded until process exit.
  Explicit `FreeLibrary`/`dlclose` of NativeAOT libraries is unsupported by .NET.

## Backend and client behavior

- Settings are committed after hardware accepts them. Mutations and durable
  saves are ordered across clients. A save failure broadcasts the active state
  and returns `PERSISTENCE_ERROR`, rather than a false success.
- Raw diagnostics validate method names, IDs, arguments, and integer widths.
  Raw fan setters cannot bypass the managed controller.
- Fan writes are awaited and serialized as pairs. Failed writes report
  `appliedSpeed: null`, then retry. Curve changes use measured temperatures;
  returning to automatic mode does not reset hot fans to minimum speed.
- Both clients render validated backend state, correlate their own responses,
  expire pending requests, cancel them on disconnect, and never replay a
  disconnected hardware write. Unrelated snapshots preserve form drafts.
- Both clients mark telemetry stale after ten seconds. Failed native channels
  downgrade capabilities and set runtime-only `restartRequired`; unaffected
  controls remain available. A new client sees the same restart guidance.
- Qt runtime tests cover actual URL semantics, IPv6 derivation, remote-close
  reconnects, request correlation, fractional/invalid edits, and Canvas
  repainting. The widget graph depicts the backend's threshold steps.
- HTTP paths and WebSocket origins are validated. Message size, request queue,
  and backpressure are bounded. Keepalive and subscriptions remain responsive
  while hardware requests are pending.
- Signal handlers are registered before initialization. Shutdown stops incoming
  work, drains fan writes, attempts both BIOS restoration commands, and releases
  WMI resources with a bounded deadline.

## Repeatable checks

```bash
bun install --frozen-lockfile
bun run all-checks
bun run test:web
c++ -std=c++17 -Wall -Wextra -Werror \
  server/native/windows/wmidll/WmiOutput.test.cpp -o /tmp/alfc-wmi-output-test
/tmp/alfc-wmi-output-test
dotnet run --project server/native/windows/cpuoc-dotnet/CPUOC.Tests.csproj
```

For browser tests, install Chromium with `bunx playwright install chromium`.
An existing local `/usr/bin/chromium` is used automatically outside CI;
`ALFC_CHROMIUM_EXECUTABLE` can select another installed binary. CI installs
Chromium and runs browser/native packing checks on Linux. The Qt CI step
installs its linked EGL/GL prerequisites and uses Qt Quick software rendering.
Checkout and Python setup actions use their Node 24 versions. Windows CI runs the
shared checks and builds the WMI DLL with MSVC.

The Qt tests use development-only PySide6, with no extra installed widget
runtime dependency. Full curve-editor tests also need the Plasma/Kirigami QML
modules documented by the runner; connection, URL, and protocol tests run with
Qt alone.

```bash
python3 -m venv /tmp/alfc-qt
/tmp/alfc-qt/bin/python -m pip install PySide6==6.8.2.1
/tmp/alfc-qt/bin/python plasmoid/run_qml_tests.py
```

## Documentation grounding

Implementation choices were checked against authoritative references:

- [Bun compiled workers](https://bun.com/docs/bundler/executables#worker),
  [Workers](https://bun.com/docs/runtime/workers), and
  [FFI](https://bun.com/docs/runtime/ffi): explicit compile entrypoints, worker
  lifecycle, and retained buffers behind native pointers.
- [Bun WebSockets](https://bun.com/docs/runtime/http/websockets) and installed
  `bun-types/serve.d.ts`: protocol pings, limits, backpressure, and `stop(true)`.
- [React context](https://react.dev/reference/react/useContext),
  [effect cleanup](https://react.dev/reference/react/useEffect), and the
  `react-use-websocket` API: callback delivery and
  `sendJsonMessage(payload, false)` to prevent write replay.
- [Playwright WebSocket routing](https://playwright.dev/docs/api/class-websocketroute):
  deterministic backend scenarios in a real browser.
- [Microsoft NativeAOT libraries](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/libraries):
  NativeAOT libraries cannot be explicitly unloaded.
- [Microsoft WMI](https://learn.microsoft.com/en-us/windows/win32/wmisdk/calling-a-method):
  typed parameters, output metadata, and asynchronous method completion.
- [Linux acpi_call source](https://github.com/nix-community/acpi_call) and
  [powercap](https://docs.kernel.org/power/powercap/powercap.html): firmware
  response format and RAPL constraints.
- [Qt JavaScript environment](https://doc.qt.io/qt-6/qtqml-javascript-hostenvironment.html),
  [WebSocket](https://doc.qt.io/qt-6/qml-qtwebsockets-websocket.html), and
  [Canvas](https://doc.qt.io/qt-6/qml-qtquick-canvas.html), verified against the
  Qt runtime instead of relying on browser assumptions.

Where documentation sites were blocked, their official GitHub sources and
installed declarations were used. The shipped Intel SDK's signatures were
inspected directly; this does not establish driver compatibility.

## Verified in the cloud checkout

- Frozen installation and `bun run all-checks`: zero lint errors/warnings,
  strict type checks, 239 passing Vitest tests, UI build, and Linux executable.
- Eight Chromium scenarios passed, including concurrent replies, failed mode
  changes, drafts, capability changes, disconnect/reconnect, invalid snapshots,
  exact large raw values, ten-second telemetry expiry, and a 320px layout.
- All 45 Qt runtime checks passed with matching Plasma/Kirigami components.
  The CI-compatible Qt-only run passed 41 and explicitly skipped four editor
  cases requiring Plasma; it did not silently omit those cases.
- Native C++ packing checks and a strict MinGW Windows DLL build/link passed.
  The Windows server/worker executable cross-compiled with ESM bytecode.
- Actual CPUOC source compiled against the shipped Intel SDK; the .NET export
  regression project executed successfully. NativeAOT publishing is not
  established by a normal C# compile.
- Source and compiled Bun worker smoke checks passed from different working
  directories. Four startup/shutdown scenarios and eleven real Bun HTTP and
  WebSocket checks passed using controlled native fixtures.
- The actual packaged Linux executable served the built UI and passed protocol
  state, origin, keepalive, malformed JSON, and unavailable ACPI checks.

## Remaining release gates

Automated checks cannot certify physical hardware. Before a production release:

1. Exercise Windows and Linux fan, temperature, and GPU calls on compatible
   Aorus hardware, including multi-argument methods and driver failures.
2. Verify BIOS automatic fan restoration during service stop and OS shutdown,
   and power-limit readback/rollback with the actual Intel driver.
3. Run the complete widget in a Plasma shell on the oldest supported and a
   current Plasma 6 release. Headless Qt is not a full desktop session.
4. Soak-test simultaneous web/KDE clients across backend restarts.

A JavaScript timeout cannot cancel firmware, a kernel ACPI operation, or a
native driver call already in progress. Failed channels are surfaced and
unavailable; recovery or a BIOS handoff cannot be guaranteed for a hung device.
End-to-end performance needs hardware measurements; raw FFI call overhead is
not an end-to-end WMI benchmark.
