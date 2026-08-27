/**
 * Real-browser smoke test for the acquisition funnel.
 *
 * Static assertions cannot prove the assessment works or that attribution
 * survives a full session, so this drives a real browser through three
 * scenarios and fails on any console error.
 *
 * Playwright is intentionally not a project dependency — CI stays fast:
 *   npm i --no-save playwright && npx playwright install chromium
 *   npm run smoke                      # local static server
 *   BASE_URL=https://… npm run smoke   # a real deployment
 *   SHOTS=work/after npm run smoke     # also capture responsive screenshots
 */
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
};

const CAMPAIGN =
  "?utm_source=google&utm_medium=cpc&utm_campaign=interview_disruption" +
  "&utm_content=cancelled&utm_term=immigrant%20visa%20interview%20cancelled";

const VIEWPORTS = [
  { name: "mobile-390", width: 390, height: 844 },
  { name: "mobile-430", width: 430, height: 932 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1440", width: 1440, height: 900 },
];

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

/** Serves the repo and captures posted events so the run needs no network. */
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
const shotsDir = process.env.SHOTS;
const local = external ? null : await startServer();
const base = external || local.base;

let events = [];
if (local) {
  local.server.on("tracked", (body) => {
    try {
      events.push(JSON.parse(body));
    } catch {
      /* ignore malformed */
    }
  });
}

const browser = await chromium.launch();
const errors = [];

async function newPage(viewport = { width: 1440, height: 900 }) {
  // A fresh context clears storage, so each scenario is a distinct visitor.
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  return page;
}

async function open(page, path = "") {
  await page.goto(base + path, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#heroCta", { state: "visible" });
}

/** Walks all five assessment questions. */
async function completeAssessment(page, { guardCheck = false } = {}) {
  await page.click("#heroCta");
  for (let step = 1; step <= 5; step += 1) {
    await page.waitForSelector("#nextBtn", { state: "visible" });
    if (await page.locator("#embassyInput").count()) {
      if (guardCheck) {
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
      }
      await page.fill("#embassyInput", "Abidjan");
    } else {
      await page.locator(".choice-card").first().click();
    }
    await page.click("#nextBtn");
  }
  await page.waitForSelector("#snapshot", { state: "visible", timeout: 10000 });
}

const eventNames = () => events.map((event) => event.name);

try {
  console.log(`\nCaseShield smoke — ${base}\n`);

  // ---- Scenario 1: paid click, full journey ------------------------------
  console.log("Scenario 1 — Google CPC, complete, alert, offer, $29");
  let page = await newPage();
  await open(page, CAMPAIGN);

  const heroMatch = await page.locator("#heroMatch").textContent().catch(() => "");
  check(
    /interview cancelled/i.test(heroMatch || ""),
    "hero message matches the campaign's utm_content",
  );

  await completeAssessment(page, { guardCheck: true });
  const plan = (await page.locator("#snapshotTitle").textContent()) || "";
  check(plan.trim().length > 0, `monitoring plan renders ("${plan.trim()}")`);

  await page.click("#alertIntent");
  await page.click("#resultOfferLink");
  await page.waitForTimeout(400);
  await page.click("#purchaseIntent");
  await page.waitForSelector("#purchaseModal", { state: "visible" });
  check(true, "$29 intent opens the transparent no-charge modal");

  if (local) {
    const names = eventNames();
    for (const required of [
      "page_view",
      "hero_cta_click",
      "case_check_started",
      "case_step_5",
      "case_check_completed",
      "alert_intent",
      "result_offer_click",
      "purchase_intent_29",
    ]) {
      check(names.includes(required), `event fired: ${required}`);
    }

    // hero_cta_click is intent to begin; case_check_started is a real answer.
    check(
      names.indexOf("hero_cta_click") < names.indexOf("case_check_started"),
      "hero_cta_click precedes case_check_started",
    );

    const attributed = events.filter((e) => e.utm_source === "google");
    check(
      attributed.length === events.length,
      `attribution on every event (${attributed.length}/${events.length})`,
    );
    const completed = events.find((e) => e.name === "case_check_completed");
    check(
      completed?.utm_campaign === "interview_disruption" &&
        completed?.utm_content === "cancelled",
      "campaign survives to the completion event",
    );
    check(
      events.every((e) => !("referrer" in e) && !("gclid" in e)),
      "no raw referrer URL or click id is ever sent",
    );
  }

  // ---- Scenario 2: same campaign, alert intent skipped -------------------
  console.log("\nScenario 2 — complete, SKIP alert intent, straight to $29");
  events = [];
  page = await newPage();
  await open(page, CAMPAIGN);
  await completeAssessment(page);
  await page.click("#resultOfferLink");
  await page.waitForTimeout(400);
  await page.click("#purchaseIntent");
  await page.waitForSelector("#purchaseModal", { state: "visible" });

  if (local) {
    const names = eventNames();
    check(!names.includes("alert_intent"), "alert intent genuinely skipped");
    check(
      names.includes("case_check_completed") &&
        names.includes("purchase_intent_29"),
      "completion and $29 intent both recorded without alert intent",
    );
  }

  // ---- Scenario 3: $29 without completing -------------------------------
  console.log("\nScenario 3 — $29 clicked WITHOUT completing a case check");
  events = [];
  page = await newPage();
  await open(page);
  await page.locator("#pricing").scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.click("#purchaseIntent");
  await page.waitForSelector("#purchaseModal", { state: "visible" });

  if (local) {
    const names = eventNames();
    check(
      names.includes("purchase_intent_29"),
      "intent is still recorded as general interest",
    );
    check(
      !names.includes("case_check_completed"),
      "no completion event, so this session cannot enter qualified WTP",
    );
  }

  // ---- Responsive and hygiene -------------------------------------------
  console.log("\nResponsive and hygiene");
  if (shotsDir) await mkdir(join(ROOT, shotsDir), { recursive: true });

  for (const viewport of VIEWPORTS) {
    const view = await newPage(viewport);
    await open(view);
    const overflow = await view.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    check(
      overflow <= 1,
      `no horizontal overflow at ${viewport.width}px (${overflow}px)`,
    );

    if (viewport.width <= 430) {
      const ctaVisible = await view.locator("#mobileCta").isVisible();
      check(ctaVisible, `sticky CTA visible on load at ${viewport.width}px`);
      await view.mouse.wheel(0, 700);
      await view.waitForTimeout(350);
      const stillVisible = await view.locator("#mobileCta").isVisible();
      check(
        stillVisible,
        `sticky CTA survives casual scrolling at ${viewport.width}px`,
      );
    }

    if (shotsDir) {
      // Return to the top so the capture shows the hero, not the scroll test.
      await view.evaluate(() => window.scrollTo(0, 0));
      await view.waitForTimeout(400);
      const file = join(ROOT, shotsDir, `${viewport.name}.png`);
      await writeFile(file, await view.screenshot({ fullPage: false }));
    }
  }

  // Legal pages must be reachable and indexable.
  for (const path of ["/privacy.html", "/terms.html"]) {
    const doc = await newPage();
    const response = await doc.goto(base + path, {
      waitUntil: "domcontentloaded",
    });
    check(response.status() === 200, `${path} loads (${response.status()})`);
  }

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
