import { chromium } from "@playwright/test";
const browser = await chromium.launch({ executablePath: "/usr/local/bin/google-chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const out = await browser.newPage({ viewport: { width: 1400, height: 1400 } });
await page.goto("https://github.com/ThatMarko/alfc/blob/docs/architecture-onboarding/ARCHITECTURE.md", { waitUntil: "networkidle", timeout: 60000 });
for (let y = 0; y < 30; y++) { await page.mouse.wheel(0, 600); await page.waitForTimeout(400); }
await page.waitForTimeout(6000);
for (const [i, f] of page.frames().filter((f) => /viewscreen/.test(f.url())).entries()) {
  const svg = await f.evaluate(() => document.querySelector("svg")?.outerHTML ?? "");
  if (!/nodeLabel/.test(svg)) continue;
  await out.setContent(`<html><head><style>body{margin:0;background:#fff}</style></head><body>${svg}</body></html>`);
  const dims = await out.evaluate(() => { const s = document.querySelector("svg"); const b = s.getBBox(); s.setAttribute("viewBox", `${b.x - 10} ${b.y - 10} ${b.width + 20} ${b.height + 20}`); s.setAttribute("width", Math.min(1300, b.width + 20)); s.removeAttribute("height"); s.style.maxWidth = "none"; return [Math.round(b.width), Math.round(b.height)]; });
  await out.locator("svg").first().screenshot({ path: `/tmp/flow-${i}.png` });
  console.log(i, dims);
}
await browser.close();
