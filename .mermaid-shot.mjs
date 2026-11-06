import { chromium } from "@playwright/test";
const browser = await chromium.launch({ executablePath: "/usr/local/bin/google-chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
for (const file of ["ARCHITECTURE.md", "README.md"]) {
  await page.goto(`https://github.com/ThatMarko/alfc/blob/docs/architecture-onboarding/${file}`, { waitUntil: "networkidle", timeout: 60000 });
  for (let y = 0; y < 30; y++) { await page.mouse.wheel(0, 600); await page.waitForTimeout(500); }
  await page.waitForTimeout(8000);
  const sections = page.locator("section[data-type=mermaid]");
  const n = await sections.count();
  for (let i = 0; i < n; i++) {
    const s = sections.nth(i);
    await s.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(3000);
    await s.screenshot({ path: `/tmp/mm-${file}-${i}.png` });
  }
  console.log(file, n);
}
await browser.close();
