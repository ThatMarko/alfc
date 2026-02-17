# Learnings

## Bun.env

- `Bun.env` is a faster alternative to `process.env` in Bun.
- It is immutable (snapshot at startup), which is fine for `NODE_ENV` checks.
- Replacing `process.env` with `Bun.env` is a simple one-line change.

## ACPI Handling

- `Bun.file().exists()` is async and returns a `Promise<boolean>`.
- `Bun.write()` and `Bun.file().text()` can throw errors if the file doesn't exist or is not accessible.
- Wrapping file operations in `try/catch` is essential for robustness when dealing with system files like `/proc/acpi/call`.
