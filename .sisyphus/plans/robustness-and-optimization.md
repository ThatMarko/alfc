# ALFC Robustness & Bun Optimization

## TL;DR

> **Quick Summary**: Add robustness improvements for Linux ACPI and Windows WMI/CPUOC, plus minor Bun optimizations (WebSocket config, Bun.env).
>
> **Deliverables**:
>
> - Linux: ACPI existence check, try/catch wrappers, graceful degradation
> - Windows: DLL existence check, WMI retry loop (3 attempts, 2s delay), non-fatal CPUOC init
> - Server: Async-safe shutdown, WebSocket idleTimeout (30s), Bun.env usage
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Task 1 → Task 4 → Task 7 → Task 8

---

## Context

### Original Request

"Minor polish + robustness fixes = all high issues fixed! All critical issues fixed, all bun optimizations?"

### Interview Summary

**Key Discussions**:

- Keep `readFileSync` (no async startup restructure)
- No new unit tests (manual QA only)
- Simple WMI retries (not worker process)

**User Decisions**:

- Sourcemaps: Skip (avoid known bugs)
- WebSocket idleTimeout: 30 seconds
- WMI retries: 3 attempts, 2s delay
- PL1/PL2 validation: No max bound (trust user config)

### Metis Review

**Identified Gaps** (addressed):

- `idleTimeout` must be ≤ 255 (Bun uses uint8) — 30s is safe
- `Bun.env` is immutable (startup snapshot) — fine for isDev check
- `--sourcemap` has bugs — user chose to skip

---

## Work Objectives

### Core Objective

Add robustness to hardware initialization (Linux ACPI, Windows WMI/CPUOC) and apply Bun API polish for WebSocket configuration.

### Concrete Deliverables

- `server/native/linux/acpi.ts` — ACPI existence check + try/catch
- `server/native/windows/acpi.ts` — DLL check + WMI retry loop
- `server/native/windows/cpuoc.ts` — DLL check + optional init
- `server/native/index.ts` — Graceful degradation with `state.isFanControlAvailable`
- `server/index.ts` — Async-safe shutdown handler, WebSocket config
- `server/fan-control/index.ts` — Async `restoreAutoFanControl()`
- `server/utils/consts.ts` — `Bun.env` replacement

### Definition of Done

- [ ] `bun run all-checks` passes (lint + type-check + test + build)
- [ ] Linux: Server starts gracefully when `/proc/acpi/call` missing
- [ ] Windows: Server starts gracefully when WMI slow or DLL missing

### Must Have

- ACPI file existence check before first use
- WMI retry loop with 3 attempts, 2-second delay
- DLL existence check before `dlopen()`
- Async shutdown handler that awaits fan restoration
- WebSocket `idleTimeout: 30`
- `Bun.env` instead of `process.env` in consts.ts

### Must NOT Have (Guardrails)

- No `readFileSync` → async migration (user said "keep sync")
- No new vitest tests (user said "no tests")
- No `--sourcemap` in build (user chose to skip)
- No PL1/PL2 max validation (user said "no validation")
- No worker process for WMI (user chose "simple retries")

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision

- **Infrastructure exists**: YES (vitest)
- **Automated tests**: NO (user chose "no tests")
- **Framework**: vitest (existing)

### QA Policy

Every task includes agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

| Deliverable Type | Verification Tool | Method                           |
| ---------------- | ----------------- | -------------------------------- |
| Server startup   | Bash              | Run server, check logs/exit code |
| TypeScript       | Bash              | `bun run type-check`             |
| Lint             | Bash              | `bun run lint`                   |
| Build            | Bash              | `bun run build`                  |

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — independent changes):
├── Task 1: Linux ACPI robustness [quick]
├── Task 2: Windows ACPI robustness (DLL check + WMI retry) [quick]
├── Task 3: Windows CPUOC robustness (DLL check + optional init) [quick]
└── Task 4: Bun.env replacement in consts.ts [quick]

Wave 2 (Integration — depends on Wave 1):
├── Task 5: Graceful degradation in native/index.ts (depends: 1, 2, 3) [quick]
├── Task 6: Async restoreAutoFanControl (depends: 1) [quick]
└── Task 7: WebSocket config (idleTimeout: 30) [quick]

Wave 3 (Shutdown — depends on Wave 2):
└── Task 8: Async-safe shutdown handler (depends: 5, 6) [quick]

Wave FINAL (Verification):
└── Task 9: Run all-checks and verify [quick]
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave  |
| ---- | ---------- | ------ | ----- |
| 1    | —          | 5, 6   | 1     |
| 2    | —          | 5      | 1     |
| 3    | —          | 5      | 1     |
| 4    | —          | —      | 1     |
| 5    | 1, 2, 3    | 8      | 2     |
| 6    | 1          | 8      | 2     |
| 7    | —          | —      | 2     |
| 8    | 5, 6       | 9      | 3     |
| 9    | 8          | —      | FINAL |

### Agent Dispatch Summary

| Wave  | # Parallel | Tasks → Agent Category |
| ----- | ---------- | ---------------------- |
| 1     | **4**      | T1-T4 → `quick`        |
| 2     | **3**      | T5-T7 → `quick`        |
| 3     | **1**      | T8 → `quick`           |
| FINAL | **1**      | T9 → `quick`           |

---

## TODOs

- [x] 1. Linux ACPI robustness

  **What to do**:
  - Add existence check for `/proc/acpi/call` before first use
  - Wrap `Bun.write()` and `Bun.file().text()` in try/catch
  - Return graceful error info instead of crashing
  - Export an `isAcpiAvailable()` function or error state

  **Must NOT do**:
  - Don't change the ACPI call format
  - Don't add async startup restructure

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single file, focused change, clear requirements
  - **Skills**: `[]`
    - No special skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4)
  - **Blocks**: Tasks 5, 6
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `server/native/linux/acpi.ts:24-28` — Current getCall implementation (add try/catch around Bun.write/Bun.file)
  - `server/native/linux/acpi.ts:31-34` — Current setCall implementation (add try/catch)

  **API/Type References**:
  - `server/native/index.ts:5-13` — ACPIModule type (may need error return type)

  **WHY Each Reference Matters**:
  - `acpi.ts:24-28`: This is where Bun.write/Bun.file are called — wrap in try/catch and check existence first
  - `native/index.ts:5-13`: Module type definition — may need to add error handling pattern

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: TypeScript compiles without errors
    Tool: Bash
    Preconditions: Changes applied to server/native/linux/acpi.ts
    Steps:
      1. Run: bun run type-check
      2. Check exit code is 0
    Expected Result: Exit code 0, no type errors
    Failure Indicators: Non-zero exit code, error messages mentioning acpi.ts
    Evidence: .sisyphus/evidence/task-1-typecheck.txt

  Scenario: Lint passes
    Tool: Bash
    Preconditions: Changes applied
    Steps:
      1. Run: bun run lint
      2. Check exit code is 0
    Expected Result: Exit code 0
    Failure Indicators: ESLint errors in acpi.ts
    Evidence: .sisyphus/evidence/task-1-lint.txt
  ```

  **Commit**: YES (groups with 2, 3, 4)
  - Message: `fix(linux): add ACPI existence check and error handling`
  - Files: `server/native/linux/acpi.ts`
  - Pre-commit: `bun run type-check`

---

- [x] 2. Windows ACPI robustness (DLL check + WMI retry)

  **What to do**:
  - Check `WmiAPI.dll` exists using `await Bun.file(path).exists()` BEFORE `dlopen()`
  - Add retry loop to `wmiInit()`: 3 attempts, 2-second delay between attempts
  - If DLL missing, throw clear error message (don't crash with cryptic dlopen error)
  - Log retry attempts for debugging

  **Must NOT do**:
  - Don't add worker process
  - Don't change FFI signatures

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single file, focused change
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4)
  - **Blocks**: Task 5
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `server/native/windows/acpi.ts:8-14` — Current dlopen call (add existence check before)
  - `server/native/windows/acpi.ts:24-30` — Current wmiInit (add retry loop)

  **External References**:
  - Bun.file().exists() — `https://bun.sh/docs/api/file-io#checking-if-a-file-exists`
  - Bun.sleep() — `https://bun.sh/docs/api/utils#bun-sleep`

  **WHY Each Reference Matters**:
  - `acpi.ts:8-14`: dlopen crashes with cryptic error if DLL missing — check first
  - `acpi.ts:24-30`: WMI can be slow to start on Windows boot — retry helps

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: TypeScript compiles without errors
    Tool: Bash
    Preconditions: Changes applied to server/native/windows/acpi.ts
    Steps:
      1. Run: bun run type-check
      2. Check exit code is 0
    Expected Result: Exit code 0
    Failure Indicators: Type errors in windows/acpi.ts
    Evidence: .sisyphus/evidence/task-2-typecheck.txt

  Scenario: Lint passes
    Tool: Bash
    Preconditions: Changes applied
    Steps:
      1. Run: bun run lint
      2. Check exit code is 0
    Expected Result: Exit code 0
    Failure Indicators: ESLint errors
    Evidence: .sisyphus/evidence/task-2-lint.txt
  ```

  **Commit**: YES (groups with 1, 3, 4)
  - Message: `fix(windows): add DLL existence check and WMI retry loop`
  - Files: `server/native/windows/acpi.ts`
  - Pre-commit: `bun run type-check`

---

- [x] 3. Windows CPUOC robustness (DLL check + optional init)

  **What to do**:
  - Check `CPUOC.dll` exists using `await Bun.file(path).exists()` BEFORE `dlopen()`
  - Make DLL loading conditional — if missing, export no-op functions
  - Export `isCpuocAvailable` flag for caller to check
  - If DLL missing, log warning but don't crash

  **Must NOT do**:
  - Don't add PL1/PL2 max validation (user said "no validation")
  - Don't change FFI signatures

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single file, focused change
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4)
  - **Blocks**: Task 5
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `server/native/windows/cpuoc.ts:7-12` — Current dlopen call (make conditional)
  - `server/native/windows/cpuoc.ts:22-28` — tuneInit (handle missing DLL)

  **WHY Each Reference Matters**:
  - `cpuoc.ts:7-12`: dlopen at module load — needs to be conditional
  - `cpuoc.ts:22-28`: tuneInit should be no-op if DLL missing

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: TypeScript compiles without errors
    Tool: Bash
    Preconditions: Changes applied to server/native/windows/cpuoc.ts
    Steps:
      1. Run: bun run type-check
      2. Check exit code is 0
    Expected Result: Exit code 0
    Failure Indicators: Type errors in windows/cpuoc.ts
    Evidence: .sisyphus/evidence/task-3-typecheck.txt

  Scenario: Lint passes
    Tool: Bash
    Preconditions: Changes applied
    Steps:
      1. Run: bun run lint
      2. Check exit code is 0
    Expected Result: Exit code 0
    Failure Indicators: ESLint errors
    Evidence: .sisyphus/evidence/task-3-lint.txt
  ```

  **Commit**: YES (groups with 1, 2, 4)
  - Message: `fix(windows): make CPUOC init optional with DLL check`
  - Files: `server/native/windows/cpuoc.ts`
  - Pre-commit: `bun run type-check`

---

- [x] 4. Bun.env replacement in consts.ts

  **What to do**:
  - Replace `process.env.NODE_ENV` with `Bun.env.NODE_ENV`
  - This is a minor Bun API polish (immutable snapshot is fine for this use case)

  **Must NOT do**:
  - Don't change any other files in this task

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: One-line change
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3)
  - **Blocks**: None
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `server/utils/consts.ts:1` — Current `process.env` usage (replace with Bun.env)

  **External References**:
  - Bun.env docs — `https://bun.sh/docs/runtime/env`

  **WHY Each Reference Matters**:
  - `consts.ts:1`: The only file using process.env that can use Bun.env

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: TypeScript compiles without errors
    Tool: Bash
    Preconditions: Changes applied to server/utils/consts.ts
    Steps:
      1. Run: bun run type-check
      2. Check exit code is 0
    Expected Result: Exit code 0
    Failure Indicators: Type errors
    Evidence: .sisyphus/evidence/task-4-typecheck.txt
  ```

  **Commit**: YES (groups with 1, 2, 3)
  - Message: `refactor(server): use Bun.env instead of process.env`
  - Files: `server/utils/consts.ts`
  - Pre-commit: `bun run type-check`

---

- [x] 5. Graceful degradation in native/index.ts

  **What to do**:
  - Add `state.isFanControlAvailable` flag to state (if not exists)
  - Wrap `wmiInit()` call in try/catch — set flag to false on failure
  - Wrap `tuneInit()` call in try/catch — already partially handled, improve
  - Log clear messages about what's available/unavailable
  - Continue startup even if WMI/ACPI fails (degraded mode)

  **Must NOT do**:
  - Don't crash on initialization failures
  - Don't skip fan control entirely if ACPI works

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Focused integration of robustness from Wave 1
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 6, 7)
  - **Blocks**: Task 8
  - **Blocked By**: Tasks 1, 2, 3

  **References**:

  **Pattern References**:
  - `server/native/index.ts:52-79` — Current initNativeServices (wrap in try/catch)
  - `server/native/index.ts:65-73` — Existing CPU tuning try/catch pattern (follow this)
  - `server/state/index.ts` — State object (may need isFanControlAvailable)

  **WHY Each Reference Matters**:
  - `index.ts:52-79`: Main init function — needs graceful degradation
  - `index.ts:65-73`: Existing pattern for optional feature handling

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: TypeScript compiles without errors
    Tool: Bash
    Preconditions: Changes applied to server/native/index.ts
    Steps:
      1. Run: bun run type-check
      2. Check exit code is 0
    Expected Result: Exit code 0
    Failure Indicators: Type errors
    Evidence: .sisyphus/evidence/task-5-typecheck.txt

  Scenario: Lint passes
    Tool: Bash
    Preconditions: Changes applied
    Steps:
      1. Run: bun run lint
      2. Check exit code is 0
    Expected Result: Exit code 0
    Failure Indicators: ESLint errors
    Evidence: .sisyphus/evidence/task-5-lint.txt
  ```

  **Commit**: YES
  - Message: `fix(native): add graceful degradation for hardware init failures`
  - Files: `server/native/index.ts`
  - Pre-commit: `bun run type-check`

---

- [x] 6. Async restoreAutoFanControl

  **What to do**:
  - Make `restoreAutoFanControl()` async (return Promise)
  - Use `await` on the setCall functions inside
  - Export as async function

  **Must NOT do**:
  - Don't change fan control logic
  - Don't change setCall signatures

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small change to one function
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 7)
  - **Blocks**: Task 8
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `server/fan-control/index.ts:27-30` — Current restoreAutoFanControl (make async)
  - `server/native/index.ts:11` — setCall returns Promise<void> (already async)

  **WHY Each Reference Matters**:
  - `fan-control/index.ts:27-30`: The function to make async
  - `native/index.ts:11`: Confirms setCall is already async — just need await

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: TypeScript compiles without errors
    Tool: Bash
    Preconditions: Changes applied to server/fan-control/index.ts
    Steps:
      1. Run: bun run type-check
      2. Check exit code is 0
    Expected Result: Exit code 0
    Failure Indicators: Type errors
    Evidence: .sisyphus/evidence/task-6-typecheck.txt

  Scenario: Existing tests pass
    Tool: Bash
    Preconditions: Changes applied
    Steps:
      1. Run: bun run test
      2. Check exit code is 0
    Expected Result: All tests pass
    Failure Indicators: Test failures
    Evidence: .sisyphus/evidence/task-6-test.txt
  ```

  **Commit**: YES
  - Message: `fix(fan-control): make restoreAutoFanControl async`
  - Files: `server/fan-control/index.ts`
  - Pre-commit: `bun run test`

---

- [x] 7. WebSocket config (idleTimeout: 30)

  **What to do**:
  - Add `idleTimeout: 30` to websocket config in `Bun.serve()`
  - Add `backpressureLimit: 1024 * 1024` (1MB) for safety

  **Must NOT do**:
  - Don't change WebSocket message handling
  - Don't add perMessageDeflate (not needed for small JSON messages)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Two config properties
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 6)
  - **Blocks**: None
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `server/index.ts:115` — Current websocket config (add properties)
  - `server/websocket/index.ts:130-140` — websocketHandlers object

  **External References**:
  - Bun WebSocket config — `https://bun.sh/docs/api/websockets`

  **WHY Each Reference Matters**:
  - `index.ts:115`: Where to add the config properties
  - Bun docs: Confirms idleTimeout uses uint8 (max 255), 30 is safe

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: TypeScript compiles without errors
    Tool: Bash
    Preconditions: Changes applied to server/index.ts
    Steps:
      1. Run: bun run type-check
      2. Check exit code is 0
    Expected Result: Exit code 0
    Failure Indicators: Type errors
    Evidence: .sisyphus/evidence/task-7-typecheck.txt
  ```

  **Commit**: YES
  - Message: `feat(websocket): add idleTimeout and backpressureLimit config`
  - Files: `server/index.ts`
  - Pre-commit: `bun run type-check`

---

- [ ] 8. Async-safe shutdown handler

  **What to do**:
  - Make shutdown handler async-aware
  - Add `isShuttingDown` flag to prevent new ACPI calls during shutdown
  - Await `restoreAutoFanControl()` before calling `server.stop()`
  - Ensure `process.exit()` is called after async operations complete

  **Must NOT do**:
  - Don't change signal handling (SIGINT, SIGTERM, SIGHUP)
  - Don't remove the exit handler override

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Focused change to shutdown logic
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (sequential)
  - **Blocks**: Task 9
  - **Blocked By**: Tasks 5, 6

  **References**:

  **Pattern References**:
  - `server/index.ts:49-69` — Current process.exit override (make async-safe)
  - `server/index.ts:120-128` — Signal handlers (update to await restoration)

  **WHY Each Reference Matters**:
  - `index.ts:49-69`: Exit handler calls restoreAutoFanControl — needs await
  - `index.ts:120-128`: Signal handlers call process.exit — may need async

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: TypeScript compiles without errors
    Tool: Bash
    Preconditions: Changes applied to server/index.ts
    Steps:
      1. Run: bun run type-check
      2. Check exit code is 0
    Expected Result: Exit code 0
    Failure Indicators: Type errors
    Evidence: .sisyphus/evidence/task-8-typecheck.txt

  Scenario: Lint passes
    Tool: Bash
    Preconditions: Changes applied
    Steps:
      1. Run: bun run lint
      2. Check exit code is 0
    Expected Result: Exit code 0
    Failure Indicators: ESLint errors
    Evidence: .sisyphus/evidence/task-8-lint.txt
  ```

  **Commit**: YES
  - Message: `fix(server): make shutdown handler async-safe`
  - Files: `server/index.ts`
  - Pre-commit: `bun run type-check`

---

- [ ] 9. Final verification

  **What to do**:
  - Run `bun run all-checks` (lint + type-check + test + build)
  - Verify all passes
  - Review build output

  **Must NOT do**:
  - Don't make code changes in this task

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Verification only
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: FINAL
  - **Blocks**: None
  - **Blocked By**: Task 8

  **References**:

  **Pattern References**:
  - `package.json` — all-checks script definition

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: All checks pass
    Tool: Bash
    Preconditions: All previous tasks completed
    Steps:
      1. Run: bun run all-checks
      2. Check exit code is 0
    Expected Result: Exit code 0, "all-checks" completes successfully
    Failure Indicators: Any non-zero exit code, lint/type/test/build errors
    Evidence: .sisyphus/evidence/task-9-all-checks.txt

  Scenario: Build produces executables
    Tool: Bash
    Preconditions: Build completed
    Steps:
      1. Check: ls -la server/dist/
      2. Verify alfc executable exists
    Expected Result: alfc file exists with executable permissions
    Failure Indicators: Missing file, wrong permissions
    Evidence: .sisyphus/evidence/task-9-build-output.txt
  ```

  **Commit**: NO (verification only)

---

## Commit Strategy

| After Task    | Message                                                  | Files                | Verification |
| ------------- | -------------------------------------------------------- | -------------------- | ------------ |
| 1-4 (grouped) | Multiple atomic commits                                  | Per task             | type-check   |
| 5             | `fix(native): add graceful degradation...`               | native/index.ts      | type-check   |
| 6             | `fix(fan-control): make restoreAutoFanControl async`     | fan-control/index.ts | test         |
| 7             | `feat(websocket): add idleTimeout and backpressureLimit` | index.ts             | type-check   |
| 8             | `fix(server): make shutdown handler async-safe`          | index.ts             | type-check   |

---

## Success Criteria

### Verification Commands

```bash
bun run all-checks  # Expected: exit 0, all pass
bun run build       # Expected: creates server/dist/alfc
```

### Final Checklist

- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] `bun run all-checks` passes
- [ ] Build produces executable
