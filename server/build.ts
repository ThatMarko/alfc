const isWindows = process.platform === "win32";
const arch = process.arch;

let target: string;
let outfile: string;

if (isWindows) {
  target = arch === "arm64" ? "bun-windows-arm64" : "bun-windows-x64";
  outfile = "dist/alfc.exe";
} else {
  target = arch === "arm64" ? "bun-linux-arm64" : "bun-linux-x64";
  outfile = "dist/alfc";
}

if (isWindows) {
  Bun.spawnSync(
    ["cmd", "/c", "if", "exist", "dist", "rmdir", "/s", "/q", "dist"],
    { stdio: ["inherit", "inherit", "inherit"] },
  );
} else {
  Bun.spawnSync(["rm", "-rf", "dist"], {
    stdio: ["inherit", "inherit", "inherit"],
  });
}

const result = Bun.spawnSync(
  [
    "bun",
    "build",
    "index.ts",
    "--compile",
    "--target",
    target,
    "--outfile",
    outfile,
    "--minify",
  ],
  { stdio: ["inherit", "inherit", "inherit"] },
);

if (result.exitCode !== 0) {
  process.exit(result.exitCode);
}
