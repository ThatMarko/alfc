import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./frontend/src",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  workers: 2,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    launchOptions: {
      executablePath:
        process.env.ALFC_CHROMIUM_EXECUTABLE ??
        (!process.env.CI && existsSync("/usr/bin/chromium")
          ? "/usr/bin/chromium"
          : undefined),
    },
  },
  webServer: {
    command: "bun run --cwd frontend start --host 127.0.0.1 --strictPort",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
  },
});
