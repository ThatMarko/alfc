import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "protocol.e2e.ts",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: {
    trace: "retain-on-failure",
    launchOptions: {
      executablePath:
        process.env.ALFC_CHROMIUM_EXECUTABLE ??
        (!process.env.CI && existsSync("/usr/bin/chromium")
          ? "/usr/bin/chromium"
          : undefined),
    },
  },
});
