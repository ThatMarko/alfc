import { chromium } from "@playwright/test";
const browser = await chromium.launch({ executablePath: "/usr/local/bin/google-chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.goto("https://github.com/ThatMarko/alfc/blob/docs/architecture-onboarding/ARCHITECTURE.md", { waitUntil: "networkidle", timeout: 60000 });
for (let y = 0; y < 30; y++) { await page.mouse.wheel(0, 600); await page.waitForTimeout(400); }
await page.waitForTimeout(5000);
for (const [i, f] of page.frames().filter((f) => /viewscreen/.test(f.url())).entries()) {
  const d = await f.evaluate(() => {
    const svg = document.querySelector("svg");
    return {
      svgText: (svg?.textContent ?? "").replace(/\s+/g, " ").slice(0, 200),
      errorEls: [...document.querySelectorAll('[class*="error"], [id*="error"]')].map((e) => String(e.className?.baseVal ?? e.className) + ": " + (e.textContent ?? "").replace(/\s+/g, " ").slice(0, 300)).slice(0, 4),
    };
  }).catch((e) => ({ evalError: String(e).slice(0, 200) }));
  console.log(`frame ${i}:`, JSON.stringify(d));
}
await browser.close();
