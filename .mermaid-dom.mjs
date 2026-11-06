import { chromium } from "@playwright/test";
const browser = await chromium.launch({ executablePath: "/usr/local/bin/google-chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.goto("https://github.com/ThatMarko/alfc/blob/docs/architecture-onboarding/ARCHITECTURE.md", { waitUntil: "networkidle", timeout: 60000 });
const sections = page.locator('section[data-type="mermaid"]');
for (let i = 0; i < await sections.count(); i++) { await sections.nth(i).scrollIntoViewIfNeeded(); await page.waitForTimeout(2500); }
for (const [i, f] of page.frames().filter((f) => /viewscreen/.test(f.url())).entries()) {
  const d = await f.evaluate(() => {
    const svg = document.querySelector("svg");
    return {
      svgText: (svg?.textContent ?? "").replace(/\s+/g, " ").slice(0, 220),
      errorEls: [...document.querySelectorAll('[class*="error"], [id*="error"]')].map((e) => (e.className?.baseVal ?? e.className) + ":" + (e.textContent ?? "").replace(/\s+/g, " ").slice(0, 200)).slice(0, 5),
      bodyText: document.body.innerText.replace(/\s+/g, " ").slice(0, 300),
    };
  }).catch((e) => ({ evalError: String(e).slice(0, 200) }));
  console.log(`frame ${i}:`, JSON.stringify(d));
}
await browser.close();
