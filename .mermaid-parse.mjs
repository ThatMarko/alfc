import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const diagrams = JSON.parse(readFileSync("/tmp/diagrams.json", "utf8"));
const browser = await chromium.launch({ executablePath: "/usr/local/bin/google-chrome", headless: true });
const page = await browser.newPage();
const logs = [];
page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
await page.goto("https://github.com/ThatMarko/alfc/blob/docs/architecture-onboarding/ARCHITECTURE.md", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(8000);
const frame = page.frames().find((f) => /viewscreen/.test(f.url()));
console.log("frame:", frame?.url().slice(0, 120));
const info = await frame.evaluate(() => ({ mermaid: typeof window.mermaid, version: window.mermaid?.version ?? window.mermaid?.mermaidAPI?.getConfig?.()?.version ?? null, keys: Object.keys(window).filter((k) => /mermaid|render/i.test(k)) }));
console.log("info:", JSON.stringify(info));
if (info.mermaid !== "undefined") {
  for (const [i, src] of diagrams.entries()) {
    const r = await frame.evaluate(async (text) => { try { await window.mermaid.parse(text); return "OK"; } catch (e) { return "ERR: " + String(e?.message ?? e).slice(0, 400); } }, src);
    console.log(`diagram ${i}:`, r);
  }
}
console.log("console:", logs.filter((l) => /error|mermaid|parse/i.test(l)).slice(0, 10).join("\n"));
await browser.close();
