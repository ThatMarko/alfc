// In Bun compiled binaries, import.meta.dirname points to a virtual filesystem
// (/$bunfs/root/ on Linux, X:\~BUN\root\ on Windows) rather than the real path.
// Detect this reliably so we always use process.execPath in compiled mode.
export const isCompiledBinary =
  Boolean(Bun.isStandaloneExecutable) ||
  import.meta.dirname.includes("/$bunfs/") ||
  /^[A-Z]:\\~BUN\\/i.test(import.meta.dirname);

export const isDev = !isCompiledBinary && Bun.env.NODE_ENV !== "production";
import path from "node:path";

// NODE_ENV controls development behavior, not whether source paths exist.
export const frontendDir = isCompiledBinary
  ? path.join(path.dirname(process.execPath), "frontend")
  : path.resolve(import.meta.dirname, "../../frontend/build");
