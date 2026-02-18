// In Bun compiled binaries, import.meta.dirname points to a virtual filesystem
// (/$bunfs/root/ on Linux, X:\~BUN\root\ on Windows) rather than the real path.
// Detect this reliably so we always use process.execPath in compiled mode.
const isCompiledBinary =
  import.meta.dirname.includes("/$bunfs/") ||
  /^[A-Z]:\\~BUN\\/i.test(import.meta.dirname);

export const isDev = !isCompiledBinary && Bun.env.NODE_ENV !== "production";
