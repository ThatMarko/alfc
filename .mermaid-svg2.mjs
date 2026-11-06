import { chromium } from "@playwright/test";
const browser = await chromium.launch({ executablePath: "/usr/local/bin/google-chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const out = await browser.newPage({ viewport: { width: 1400, height: 1400 } });
await page.goto("https://github.com/ThatMarko/alfc/blob/docs/architecture-onboarding/ARCHITECTURE.md", { waitUntil: "networkidle", timeout: 60000 });
for (let y = 0; y < 30; y++) { await page.mouse.wheel(0, 600); await page.waitForTimeout(400); }
await page.waitForTimeout(6000);
const frames = page.frames().filter((f) => /viewscreen/.test(f.url()));
for (const [i, f] of frames.entries()) {
  const { svg, vb, first } = await f.evaluate(() => { const s = document.querySelector("svg"); return { svg: s?.outerHTML ?? "", vb: s?.getAttribute("viewBox"), first: [...(s?.querySelectorAll(".nodeLabel, text.actor") ?? [])].map((e) => e.textContent.trim())[0] }; });
  if (/sequence|actor/.test(svg) && /text class="actor/.test(svg)) continue;
  await out.setContent(`<html><head><style>body{margin:0;background:#fff}svg{width:1300px!important;max-width:none!important;height:auto!important}</style></head><body>${svg}</body></html>`);
  await out.locator("svg").first().screenshot({ path: `/tmp/flow-${i}.png` });
  console.log(i, vb, first);
}
await browser.close();
