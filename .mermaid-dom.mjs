import { chromium } from "@playwright/test";
const browser = await chromium.launch({ executablePath: "/usr/local/bin/google-chrome", headless: true });
for (const run of [1, 2]) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const failed = [];
  page.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url().slice(0, 110)}`); });
  await page.goto("https://github.com/ThatMarko/alfc/blob/docs/architecture-onboarding/ARCHITECTURE.md", { waitUntil: "networkidle", timeout: 60000 });
  for (let y = 0; y < 30; y++) { await page.mouse.wheel(0, 600); await page.waitForTimeout(500); }
  await page.waitForTimeout(8000);
  const labels = [];
  for (const f of page.frames().filter((f) => /viewscreen/.test(f.url()))) {
    labels.push(await f.evaluate(() => [...document.querySelectorAll("svg .nodeLabel, svg text.actor")].map((e) => e.textContent.trim()).slice(0, 3).join(" | ")).catch((e) => "ERR " + e));
  }
  const errs = await page.locator("section[data-type=mermaid]").evaluateAll((els) => els.map((el) => { const e = [...el.querySelectorAll("*")].find((n) => /Unable to render rich display/.test(n.textContent) && n.children.length === 0); return e ? e.offsetParent !== null : false; }));
  console.log(`run ${run}:`, JSON.stringify({ labels, errorVisiblePerSection: errs, failed }));
  await page.close();
}
await browser.close();
