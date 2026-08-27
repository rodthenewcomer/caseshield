/**
 * Real-browser smoke test for the acquisition funnel.
 *
 * Static assertions cannot prove the assessment actually works, so this drives
 * a real browser through all five steps and fails on any console error.
 *
 * Playwright is intentionally not a project dependency — CI stays fast:
 *   npm i --no-save playwright && npx playwright install chromium
 *   npm run smoke                    # or BASE_URL=https://… npm run smoke
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
};

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

/** Serves the repo and stubs the event endpoint so the run needs no network. */
function startServer() {
  const server = createServer(async (req, res) => {
    if (req.url.startsWith("/api/event")) {
      let body = "";
      for await (const chunk of req) body += chunk;
      server.emit("tracked", body);
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: true, stored: false }));
    }
    const path = req.url.split("?")[0];
    const file = join(ROOT, normalize(path === "/" ? "/index.html" : path));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403);
      return res.end("forbidden");
    }
    try {
      const data = await readFile(file);
      res.writeHead(200, {
        "content-type": TYPES[extname(file)] || "application/octet-stream",
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` }),
    );
  });
}

const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${message}`);
  if (!ok) failures.push(message);
};

const external = process.env.BASE_URL;
const local = external ? null : await startServer();
const base = external || local.base;
const tracked = [];
if (local) {
  local.server.on("tracked", (body) => {
    try {
      tracked.push(JSON.parse(body).name);
    } catch {
      /* ignore malformed */
    }
  });
}

const browser = await chromium.launch();
const errors = [];

async function newPage(viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  return page;
}

try {
  console.log(`\nCaseShield smoke — ${base}\n`);

  // ---- Desktop: complete the five-step assessment -------------------------
  const page = await newPage({ width: 1440, height: 900 });
  await page.goto(base, { waitUntil: "networkidle" });
  check((await page.title()).length > 0, "page loads with a title");

  await page.click("#heroCta");
  for (let step = 1; step <= 5; step += 1) {
    await page.waitForSelector("#nextBtn", { state: "visible" });
    if (await page.locator("#embassyInput").count()) {
      // The privacy guard must block a case number before anything is sent.
      await page.fill("#embassyInput", "ABJ2026123456");
      await page.click("#nextBtn");
      const blocked = await page
        .locator("#assessmentError")
        .textContent()
        .catch(() => "");
      check(
        /never a case number/i.test(blocked || ""),
        "rejects a probable case number in the embassy field",
      );
      await page.fill("#embassyInput", "London");
    } else {
      await page.locator(".choice-card").first().click();
    }
    await page.click("#nextBtn");
  }

  await page.waitForSelector("#snapshot", { state: "visible", timeout: 8000 });
  const plan = (await page.locator("#snapshotTitle").textContent()) || "";
  check(plan.trim().length > 0, `monitoring plan renders ("${plan.trim()}")`);

  await page.click("#purchaseIntent");
  await page.waitForSelector("#purchaseModal", { state: "visible" });
  check(true, "$29 intent opens the transparent no-charge modal");

  if (local) {
    const required = [
      "page_view",
      "case_check_started",
      "case_step_5",
      "case_check_completed",
      "purchase_intent_29",
    ];
    for (const name of required) {
      check(tracked.includes(name), `funnel event fired: ${name}`);
    }
  }

  // ---- Mobile: iPhone width must not scroll sideways ----------------------
  const mobile = await newPage({ width: 390, height: 844 });
  await mobile.goto(base, { waitUntil: "networkidle" });
  const overflow = await mobile.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  check(overflow <= 1, `no horizontal overflow at 390px (${overflow}px)`);

  check(errors.length === 0, `no console or page errors (${errors.length})`);
  errors.forEach((error) => console.log(`       ${error}`));
} finally {
  await browser.close();
  if (local) local.server.close();
}

console.log(
  failures.length
    ? `\n${failures.length} smoke check(s) failed.\n`
    : "\nAll smoke checks passed.\n",
);
process.exit(failures.length ? 1 : 0);
