import { chromium } from "@playwright/test";
const browser = await chromium.launch({ executablePath: "/usr/local/bin/google-chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
for (const file of ["README.md", "ARCHITECTURE.md"]) {
  await page.goto(`https://github.com/ThatMarko/alfc/blob/docs/architecture-onboarding/${file}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(10000);
  const sections = page.locator('section[data-type="mermaid"], [data-type="mermaid"]');
  const n = await sections.count();
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = sections.nth(i);
    await s.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(1500);
    const errVisible = await s.getByText(/Unable to render rich display/i).isVisible().catch(() => false);
    const box = await s.boundingBox();
    await s.screenshot({ path: `/tmp/mm-${file}-${i}.png` }).catch(() => {});
    out.push({ i, errVisible, h: box ? Math.round(box.height) : null });
  }
  const svgFrames = [];
  for (const f of page.frames()) {
    if (!/viewscreen/.test(f.url())) continue;
    const nodes = await f.locator("svg g.node, svg .node, svg .actor").count().catch(() => -1);
    svgFrames.push(nodes);
  }
  console.log(file, JSON.stringify({ sections: n, out, nodeCountsPerFrame: svgFrames }));
}
await browser.close();
