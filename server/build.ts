import { rm } from "node:fs/promises";
import path from "node:path";

const isWindows = process.platform === "win32";
const arch = process.arch;
if (process.platform !== "linux" && !isWindows) {
  throw new Error(`Unsupported server platform: ${process.platform}`);
}
if (arch !== "x64" && arch !== "arm64") {
  throw new Error(`Unsupported server architecture: ${arch}`);
}
if (isWindows && arch !== "x64") {
  throw new Error("Windows native libraries currently require an x64 build.");
}
const serverDir = import.meta.dirname;
const distDir = path.join(serverDir, "dist");

let target: "bun-windows-x64" | "bun-linux-arm64" | "bun-linux-x64";
let outfile: string;

if (isWindows) {
  target = "bun-windows-x64";
  outfile = "dist/alfc.exe";
} else {
  target = arch === "arm64" ? "bun-linux-arm64" : "bun-linux-x64";
  outfile = "dist/alfc";
}

await rm(distDir, { recursive: true, force: true });

const result = await Bun.build({
  // Bundled workers must be explicit entrypoints so compiled executables can
  // resolve their source URL in Bun's virtual filesystem.
  entrypoints: isWindows
    ? [
        path.join(serverDir, "index.ts"),
        path.join(serverDir, "native/windows/hardware.worker.ts"),
      ]
    : [path.join(serverDir, "index.ts")],
  compile: {
    target,
    outfile: path.join(serverDir, outfile),
    // Packaged settings live beside the executable. Avoid reading unrelated
    // .env or bunfig.toml files from the service's working directory.
    autoloadDotenv: false,
    autoloadBunfig: false,
  },
  format: "esm",
  minify: true,
  bytecode: true,
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}
