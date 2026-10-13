import { rm } from "node:fs/promises";

const isWindows = process.platform === "win32";
const arch = process.arch;

let target:
  "bun-windows-arm64" | "bun-windows-x64" | "bun-linux-arm64" | "bun-linux-x64";
let outfile: string;

if (isWindows) {
  target = arch === "arm64" ? "bun-windows-arm64" : "bun-windows-x64";
  outfile = "dist/alfc.exe";
} else {
  target = arch === "arm64" ? "bun-linux-arm64" : "bun-linux-x64";
  outfile = "dist/alfc";
}

await rm("dist", { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: ["index.ts"],
  compile: {
    target,
    outfile,
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
