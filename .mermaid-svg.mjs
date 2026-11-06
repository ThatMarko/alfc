import { chromium } from "@playwright/test";
const browser = await chromium.launch({ executablePath: "/usr/local/bin/google-chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const out = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
for (const file of ["ARCHITECTURE.md", "README.md"]) {
  await page.goto(`https://github.com/ThatMarko/alfc/blob/docs/architecture-onboarding/${file}`, { waitUntil: "networkidle", timeout: 60000 });
  for (let y = 0; y < 30; y++) { await page.mouse.wheel(0, 600); await page.waitForTimeout(400); }
  await page.waitForTimeout(6000);
  const frames = page.frames().filter((f) => /viewscreen/.test(f.url()));
  for (const [i, f] of frames.entries()) {
    const svg = await f.evaluate(() => document.querySelector("svg")?.outerHTML ?? "");
    const syntaxError = /Syntax error/i.test(svg);
    await out.setContent(`<html><body style="margin:0;background:#fff">${svg}</body></html>`);
    const el = out.locator("svg").first();
    await el.screenshot({ path: `/tmp/svg-${file}-${i}.png` }).catch((e) => console.log("shot failed", String(e).slice(0, 120)));
    console.log(file, i, JSON.stringify({ bytes: svg.length, syntaxError }));
  }
}
await browser.close();
