import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const requiredFiles = [
  "index.html",
  "styles.css",
  "app.js",
  "intelligence.js",
  "api/event.js",
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

console.log(`CaseShield source checks passed (${requiredFiles.length} files).`);
