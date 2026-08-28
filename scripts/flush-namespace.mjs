/**
 * Deletes analytics keys for ONE environment namespace.
 *
 * Preview and production may share a database, so a database-wide flush is
 * never acceptable as cleanup: it would destroy the production dataset while
 * "cleaning up a preview test". This scans and deletes only `cs:v1:<env>:*`.
 *
 *   KV_REST_API_URL=… KV_REST_API_TOKEN=… \
 *     node scripts/flush-namespace.mjs preview [--apply]
 *
 * Without --apply it reports what it would delete and changes nothing.
 */

const ALLOWED = new Set(["prod", "preview", "dev"]);
const [, , rawNamespace, ...flags] = process.argv;
const apply = flags.includes("--apply");

if (!ALLOWED.has(rawNamespace)) {
  console.error(
    `Usage: node scripts/flush-namespace.mjs <${[...ALLOWED].join("|")}> [--apply]`,
  );
  process.exit(1);
}

const url = (
  process.env.KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  ""
).replace(/\/+$/, "");
const token =
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";

if (!url || !token) {
  console.error("Set KV_REST_API_URL and KV_REST_API_TOKEN.");
  process.exit(1);
}

const PREFIX = `cs:v1:${rawNamespace}:`;

async function command(parts) {
  const response = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify([parts]),
  });
  if (!response.ok) throw new Error(`upstash_http_${response.status}`);
  const [entry] = await response.json();
  return entry?.result;
}

// SCAN rather than KEYS: never block the server, and never match by accident.
const matched = [];
let cursor = "0";
do {
  const [next, batch] = await command([
    "SCAN",
    cursor,
    "MATCH",
    `${PREFIX}*`,
    "COUNT",
    "500",
  ]);
  cursor = String(next);
  matched.push(...(batch || []));
} while (cursor !== "0");

const unique = [...new Set(matched)];
// Belt and braces: never delete a key that is not in the target namespace.
const safe = unique.filter((key) => key.startsWith(PREFIX));
const rejected = unique.length - safe.length;

console.log(`namespace : ${PREFIX}*`);
console.log(`matched   : ${safe.length} key(s)`);
if (rejected) console.log(`rejected  : ${rejected} key(s) outside the namespace`);

if (!safe.length) {
  console.log("nothing to delete.");
  process.exit(0);
}

if (!apply) {
  console.log("\nDry run. Re-run with --apply to delete these keys.");
  safe.slice(0, 10).forEach((key) => console.log(`  ${key}`));
  if (safe.length > 10) console.log(`  … and ${safe.length - 10} more`);
  process.exit(0);
}

for (let index = 0; index < safe.length; index += 100) {
  await command(["DEL", ...safe.slice(index, index + 100)]);
}

const [, remaining] = await command([
  "SCAN",
  "0",
  "MATCH",
  `${PREFIX}*`,
  "COUNT",
  "500",
]);
console.log(`deleted   : ${safe.length}`);
console.log(`remaining : ${(remaining || []).length}`);
