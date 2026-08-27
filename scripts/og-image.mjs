/**
 * Regenerates the Open Graph card at og.png.
 *
 * Playwright is deliberately not a project dependency, so this is run on
 * demand rather than in CI:
 *   npm i --no-save playwright && npx playwright install chromium
 *   node scripts/og-image.mjs
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error(
    "Playwright is not installed.\n" +
      "  npm i --no-save playwright && npx playwright install chromium",
  );
  process.exit(1);
}

const CARD = `<!doctype html>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; }
  body {
    width: 1200px; height: 630px; display: flex; flex-direction: column;
    justify-content: center; gap: 26px; padding: 74px;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    background:
      radial-gradient(900px 520px at 82% 12%, rgba(91,92,246,.16), transparent 62%),
      radial-gradient(700px 460px at 6% 96%, rgba(54,191,250,.12), transparent 62%),
      #ffffff;
    color: #111827;
  }
  .brand { display: flex; align-items: center; gap: 14px; }
  .brand span { font-size: 27px; font-weight: 800; letter-spacing: -.02em; }
  h1 { font-size: 68px; line-height: 1.04; letter-spacing: -.045em; max-width: 15ch; }
  h1 em { font-style: normal; color: #4A5568; }
  p { font-size: 25px; color: #475467; max-width: 46ch; line-height: 1.45; }
  .row { display: flex; gap: 10px; margin-top: 6px; }
  .chip {
    border: 1px solid #E4E7EC; background: rgba(255,255,255,.8);
    border-radius: 999px; padding: 9px 15px;
    font-size: 16px; font-weight: 650; color: #475467;
  }
  .chip.accent { border-color: #D9DAFF; background: #F5F3FF; color: #4A4BD8; }
</style>
<div class="brand">
  <svg width="42" height="42" viewBox="0 0 40 40" aria-hidden="true">
    <path d="M20 3.7 32.2 8v9.5c0 8.6-5 15.3-12.2 19-7.2-3.7-12.2-10.4-12.2-19V8L20 3.7Z" fill="#5B5CF6"/>
    <circle cx="20" cy="15.1" r="2.1" fill="#fff"/>
  </svg>
  <span>CaseShield</span>
</div>
<h1>Your interview changed. <em>Your next move shouldn't be a guess.</em></h1>
<p>Official updates, embassy-specific reports and your timeline, organized into one clear monitoring plan.</p>
<div class="row">
  <div class="chip accent">Private beta</div>
  <div class="chip">Official sources first</div>
  <div class="chip">No case number required</div>
</div>`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 1,
});
await page.setContent(CARD, { waitUntil: "load" });
const image = await page.screenshot({ type: "png" });
await browser.close();

const out = fileURLToPath(new URL("../og.png", import.meta.url));
await writeFile(out, image);
console.log(`Wrote ${out} (${(image.length / 1024).toFixed(1)} KB)`);
