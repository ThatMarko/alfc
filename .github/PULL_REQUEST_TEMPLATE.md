## Problem and resulting behavior

<!-- State the concrete trigger, previous behavior, and corrected result. Describe the final implementation for someone who has not read the chat. -->

## Scope and compatibility

<!-- List affected backend, web, widget, native, packaging, and documentation areas. Explain platform/capability limitations and migration requirements. Update common/PROTOCOL.md and common/COMPATIBILITY.md when the contract changes. -->

## Verification

- [ ] `bun install --frozen-lockfile` and `bun run all-checks` pass with the pinned Bun and Node 24 toolchain.
- [ ] Relevant web UI browser checks and Qt/widget runtime checks pass, or an unavailable runtime is identified with its impact.
- [ ] Native interface or service/packaging changes have focused regression coverage; host service installation was not used as a cloud unit test.
- [ ] Hardware evidence names the laptop model, OS, controls exercised, and shutdown/restart result; explicitly state when hardware testing was unavailable.
- [ ] Every changed Markdown file describes the resulting behavior, commands, and limits accurately.

## Review evidence and remaining limits

<!-- Include meaningful test results and direct evidence for important API/platform decisions. Separate mocked validation from actual Windows/Linux hardware, UAC/SCM, Plasma desktop, or proprietary SDK validation. Name unresolved issues rather than promising perfect parity. -->
