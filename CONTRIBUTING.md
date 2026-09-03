# Contributing to ALFC

Thanks for considering a contribution. This project controls real hardware, so a
little extra care in how changes are made and verified goes a long way.

## Report issues first

If something is broken or missing, open an issue before writing code:

- **Bugs** — use the bug report template. Include your laptop model, OS/distro,
  ALFC version, and the relevant logs (`service.log` on Windows,
  `journalctl -u alfc` on Linux). Most bugs are model- and OS-specific; without
  that context they are hard to reproduce.
- **Feature requests** — use the feature request template and describe the
  problem you are trying to solve, not just the feature you want.

Security issues must not be reported in public issues — see
[SECURITY.md](SECURITY.md).

## Development setup

1. Install [Bun](https://bun.sh) `>=1.3.9` (CI pins 1.3.9; `packageManager`
   declares 1.4.0).
2. `bun install` in the repository root (Bun workspaces: `frontend`, `server`).
3. `sudo bun run start` — frontend at `:3000`, server at `:5522`. The server
   requires elevation and exits otherwise.

### Required checks

Run everything that CI runs before pushing:

```bash
bun run all-checks   # lint + type-check + test + build
```

Individual commands: `bun run lint`, `bun run type-check`, `bun run test`.
Husky + lint-staged also runs ESLint, type-check, and Prettier on staged files
at commit time.

## Where things live

| Area            | Location                         | Notes                                                                |
| --------------- | -------------------------------- | -------------------------------------------------------------------- |
| Fan control     | `server/fan-control/`            | Ramping logic, tests colocated                                       |
| Hardware access | `server/native/{linux,windows}/` | ACPI/WMI platform abstraction                                        |
| WebSocket API   | `server/websocket/` + `common/`  | Protocol documented in `common/PROTOCOL.md`                          |
| Web UI          | `frontend/`                      | React + Vite, WebSocket hook in `frontend/src/utils/useWebSocket.ts` |
| Plasma widget   | `plasmoid/package/`              | Pure QML, all user-visible strings wrapped in `i18n()`               |
| Service scripts | `bootstrap/scripts/`             | Shell scripts + WinSW config, no TypeScript                          |

## Conventions

These come from `AGENTS.md` and are enforced by checks:

- **ESM imports**: extensionless relative imports; `node:` prefix for built-ins.
- **TypeScript**: `strict` + `noUncheckedIndexedAccess` — handle `undefined`
  from indexed access; no explicit `any`; unused variables get `_` prefix.
- **Accessibility**: `aria-label` on all interactive frontend elements; QML uses
  `Accessible.role` / `Accessible.name`.
- **i18n**: every user-visible QML string goes through `i18n()`.
- **No containers**: build with `bun run build`, tests are colocated `*.test.ts`.

## Pull request process

1. Fork the repository and create a branch off `master`.
2. Make the change. Keep it small; split unrelated work into separate PRs.
3. Run `bun run all-checks` locally.
4. Describe hardware testing in the PR description when the change touches
   native or fan-control code — automated tests mock hardware and cannot prove
   ACPI/WMI behavior on a real laptop.
5. Protocol changes must keep `common/PROTOCOL.md` and
   `common/COMPATIBILITY.md` in sync, and follow the versioning policy there.

### Commit messages

Use the conventional commit style already used in this repository
(`type(scope): subject`), e.g. `feat(plasmoid): ...`, `fix(windows): ...`,
`docs: ...`, `chore: ...`.

## What to test on hardware

The CI matrix cannot cover:

- Real ACPI/WMI calls on Aorus hardware (Linux and Windows)
- Fan ramp behavior and safe restore of BIOS automatic control on exit
- Plasmoid behavior inside Plasma 6 (use `plasmoidviewer -a plasmoid/package`)

If you changed something in these areas and cannot test it on hardware, say so
explicitly in the PR — that is still valuable, it just needs a reviewer who can.
