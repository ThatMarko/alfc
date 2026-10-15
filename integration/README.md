# Cross-client production protocol tests

Run on Linux with both IPv4 and IPv6 loopback available. This tier requires
Node 24, the pinned Bun toolchain, Chromium, Python 3.12, and
`PySide6==6.12.0`. Qt/Plasma editor component tests are a separate tier; this
suite uses Qt's actual widget `BackendConnection.qml` without loading Plasma.

```sh
bun install --frozen-lockfile
bun run --cwd frontend build
python3 -m venv "$HOME/.venvs/alfc-integration"
"$HOME/.venvs/alfc-integration/bin/python" -m pip install PySide6==6.12.0
bun x playwright install chromium
ALFC_QT_PYTHON="$HOME/.venvs/alfc-integration/bin/python" bun run test:integration
```

The production web client uses backend port 5522, so leave that port free on
both loopback addresses. Do not run this suite alongside a running ALFC service
or other tests that own that port. `ALFC_BUN_EXECUTABLE`, `ALFC_QT_PYTHON`, and
`ALFC_CHROMIUM_EXECUTABLE` select already installed test tools; they are not
backend settings. Artifacts and retained failure traces go in
`integration/test-results/`.

Each scenario copies the current server and common sources to a disposable
directory, links installed dependencies, and writes its own configuration.
The explicit `protocol-fixture.ts` entrypoint replaces only Linux's ACPI and
CPU-tuning adapters through Bun's test module API. It then runs the unchanged
production native queues, fan-control writes and telemetry, capability failure
reporter, WebSocket handlers, atomic persistence, loopback listeners, and shared
HTTP handler. Control commands travel over the child process's standard input;
there are no test-only network endpoints or production environment switches.
The fixture rejects non-Linux execution before loading native services because
only Linux adapters are substituted. It does not import the elevated production
entrypoint. Production
permission and startup ordering checks remain in the server suites.

The browser runs the built production UI against the real IPv4 listener. A
separate PySide process runs the actual QML transport against IPv6, including
the supported `/ws/` alias. The scenarios verify initial state and subscribed
telemetry, bidirectional state broadcasts, independent browser drafts,
correlated success/error replies, disconnection during an admitted paired fan
write, lost acknowledgement handling without replay, isolated permanent native
channel failures, genuine filesystem persistence failure, and restart loading
only durable settings. Restart also verifies that the persisted fan target is
applied to the fake adapter and runtime failure flags are recomputed. Cleanup
checks both BIOS restoration commands, native cleanup, and natural child-process
exit; a process requiring forced termination fails the suite.

This establishes cross-client production protocol behavior with deterministic
hardware. It does not establish a full Plasma shell session, Windows native
execution, firmware compatibility, physical fan rotation, or measured CPU power.
