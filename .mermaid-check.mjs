import { chromium } from "@playwright/test";
const browser = await chromium.launch({ executablePath: "/usr/local/bin/google-chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
for (const file of ["README.md", "ARCHITECTURE.md"]) {
  await page.goto(`https://github.com/ThatMarko/alfc/blob/docs/architecture-onboarding/${file}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(8000);
  const frames = page.frames().filter((f) => /viewscreen|mermaid|render/.test(f.url()));
  const results = [];
  for (const f of frames) {
    const svg = await f.locator("svg").count().catch(() => -1);
    const text = (await f.locator("body").innerText().catch(() => "")).slice(0, 160).replace(/\s+/g, " ");
    results.push({ svg, error: /unable|error|parse/i.test(text) ? text : "" });
  }
  const errors = await page.getByText(/Unable to render rich display/i).count();
  console.log(file, JSON.stringify({ frames: frames.length, pageErrors: errors, results }));
  await page.screenshot({ path: `/tmp/mermaid-${file}.png`, fullPage: true });
}
await browser.close();
