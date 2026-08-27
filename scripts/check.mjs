import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const requiredFiles = [
  "index.html",
  "styles.css",
  "app.js",
  "intelligence.js",
  "api/event.js",
  "api/validation.js",
  "acquisition.js",
  "lib/store.mjs",
  "lib/events.mjs",
  "lib/funnel.mjs",
  "lib/redis.mjs",
  "lib/attribution.mjs",
  "validation.html",
  "validation.js",
  "robots.txt",
  "SECURITY.md",
  "vercel.json",
];

const contents = Object.fromEntries(
  await Promise.all(
    requiredFiles.map(async (file) => [
      file,
      await readFile(new URL(`../${file}`, import.meta.url), "utf8"),
    ]),
  ),
);

assert.match(
  contents["index.html"],
  /PRIVATE BETA/,
  "The validation state must be visible in the hero.",
);
assert.match(
  contents["index.html"],
  /No payment will be taken today/,
  "The price test must not look like a real charge.",
);
assert.match(
  contents["index.html"],
  /No event above is presented as verified live data/,
  "Illustrative signals need an explicit label.",
);
assert.match(
  contents["index.html"],
  /provide individualized legal advice/,
  "The legal-information boundary must remain visible.",
);
assert.match(
  contents["index.html"],
  /type="module" src="\/app\.js"/,
  "The app must load through the strict-CSP module entrypoint.",
);
assert.doesNotMatch(
  contents["index.html"],
  /\sstyle=/i,
  "Inline styles would weaken the strict CSP.",
);
assert.doesNotMatch(
  contents["app.js"],
  /\.innerHTML\b|insertAdjacentHTML|document\.write|\beval\s*\(/,
  "Avoid unsafe DOM and code-execution sinks.",
);
assert.doesNotMatch(
  contents["app.js"],
  /\.style\./,
  "Runtime inline styles would be blocked by the strict CSP.",
);

// The internal dashboard must meet the same bar as the public site.
assert.doesNotMatch(
  contents["validation.js"],
  /\.innerHTML\b|insertAdjacentHTML|document\.write|\beval\s*\(|\.style\./,
  "The dashboard must avoid unsafe DOM sinks and runtime inline styles.",
);
assert.doesNotMatch(
  contents["validation.html"],
  /\sstyle=/i,
  "Inline styles would weaken the strict CSP.",
);
assert.match(
  contents["validation.html"],
  /name="robots" content="noindex, nofollow"/,
  "Internal business metrics must never be indexed.",
);
assert.match(
  contents["robots.txt"],
  /Disallow: \/validation/,
  "robots.txt must keep crawlers away from the internal dashboard.",
);

// Business metrics must fail closed rather than leak.
assert.match(
  contents["api/validation.js"],
  /timingSafeEqual/,
  "Dashboard auth must use a constant-time comparison.",
);
assert.match(
  contents["api/validation.js"],
  /dashboard_not_configured/,
  "The dashboard must fail closed when no token is configured.",
);

// Analytics must never take the product down with it.
assert.match(
  contents["lib/store.mjs"],
  /not_configured/,
  "The store must degrade gracefully when unconfigured.",
);
assert.doesNotMatch(
  contents["lib/store.mjs"],
  /KV_REST_API_TOKEN\s*=\s*["']/,
  "Store credentials must come from the environment, never source.",
);

const vercelConfig = JSON.parse(contents["vercel.json"]);
const globalHeaders =
  vercelConfig.headers.find((entry) => entry.source === "/(.*)")?.headers || [];
const csp =
  globalHeaders.find((header) => header.key === "Content-Security-Policy")
    ?.value || "";
assert.match(
  csp,
  /script-src 'self'/,
  "CSP must restrict scripts to the same origin.",
);
assert.match(csp, /frame-ancestors 'none'/, "CSP must prevent framing.");
assert.doesNotMatch(
  csp,
  /unsafe-inline|unsafe-eval/,
  "CSP must not enable unsafe script or style execution.",
);

// Optional actions must never sit inside the mandatory funnel chain: that is
// what makes a stage conversion divide by the wrong denominator.
assert.doesNotMatch(
  contents["lib/events.mjs"],
  /CORE_FUNNEL = \[[^\]]*alert_intent/s,
  "alert_intent is optional and must stay out of the core funnel.",
);
assert.match(
  contents["lib/funnel.mjs"],
  /SINTERCARD/,
  "Qualified WTP must use an exact set intersection, never raw counts.",
);

// Acquisition data must stay campaign-only.
// Reading document.referrer is required to derive the host; storing the raw
// URL or a click id is not.
assert.match(
  contents["acquisition.js"],
  /new URL\(referrer\)\.hostname/,
  "The referrer must be reduced to a hostname.",
);
assert.doesNotMatch(
  contents["acquisition.js"],
  /referrer_url|gclid|fbclid|msclkid/i,
  "Full referrer URLs and click identifiers must never be captured.",
);
assert.doesNotMatch(
  contents["acquisition.js"],
  /\.innerHTML\b|insertAdjacentHTML|document\.write|\beval\s*\(/,
  "Avoid unsafe DOM and code-execution sinks.",
);
assert.match(
  contents["acquisition.js"],
  /SAFE_CONTENT_VARIANTS/,
  "Hero copy must come from a trusted enum, not raw UTM text.",
);

console.log(`CaseShield source checks passed (${requiredFiles.length} files).`);
