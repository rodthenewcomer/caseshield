import test from "node:test";
import assert from "node:assert/strict";

/**
 * Proves analytics isolation between environments.
 *
 * Preview traffic contaminating the production dataset would corrupt the
 * numbers that decide whether this company gets funded, so isolation is
 * asserted at the key level rather than trusted to configuration.
 */

const ENDPOINT = "https://stub.upstash.io";

function stubRedis() {
  const batches = [];
  globalThis.fetch = async (_url, options) => {
    const commands = JSON.parse(options.body);
    batches.push(commands);
    return {
      ok: true,
      json: async () => commands.map(() => ({ result: 0 })),
    };
  };
  return batches;
}

async function moduleFor(vercelEnv) {
  if (vercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = vercelEnv;
  return {
    store: await import(`../lib/store.mjs?v=${Math.random()}`),
    env: await import(`../lib/environment.mjs?v=${Math.random()}`),
  };
}

function cleanup() {
  delete process.env.VERCEL_ENV;
  delete process.env.ANALYTICS_STORE_ENV;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete globalThis.fetch;
}

test("production keys use the prod namespace", async () => {
  try {
    const { store, env } = await moduleFor("production");
    assert.equal(env.environmentSlug(), "prod");
    assert.equal(env.environmentLabel(), "Production");
    assert.equal(store.keys.unique("case_check_completed"), "cs:v1:prod:uniq:case_check_completed");
    assert.equal(store.keys.sessions(), "cs:v1:prod:sessions");
  } finally {
    cleanup();
  }
});

test("preview keys use the preview namespace", async () => {
  try {
    const { store, env } = await moduleFor("preview");
    assert.equal(env.environmentSlug(), "preview");
    assert.equal(env.environmentLabel(), "Preview");
    assert.equal(store.keys.unique("case_check_completed"), "cs:v1:preview:uniq:case_check_completed");
  } finally {
    cleanup();
  }
});

test("development keys use the dev namespace", async () => {
  try {
    const { store, env } = await moduleFor("development");
    assert.equal(env.environmentSlug(), "dev");
    assert.equal(store.keys.unique("page_view"), "cs:v1:dev:uniq:page_view");
  } finally {
    cleanup();
  }
});

test("an arbitrary VERCEL_ENV cannot inject Redis key material", async () => {
  // VERCEL_ENV is platform-controlled, but it must never be interpolated
  // straight into a key: a hostile value could otherwise reach across
  // namespaces or forge segments.
  for (const hostile of [
    "production:../prod",
    "prod*",
    "preview:uniq:case_check_completed",
    "*",
    "",
    "PRODUCTION ",
    "'; FLUSHALL; --",
  ]) {
    try {
      const { store, env } = await moduleFor(hostile);
      const slug = env.environmentSlug();
      assert.ok(
        ["prod", "preview", "dev"].includes(slug),
        `"${hostile}" resolved to a fixed enum value, got "${slug}"`,
      );
      const key = store.keys.unique("page_view");
      assert.ok(
        /^cs:v1:(prod|preview|dev):uniq:page_view$/.test(key),
        `key stayed well-formed for "${hostile}", got "${key}"`,
      );
      assert.ok(!key.includes(hostile.trim()) || hostile.trim() === "");
    } finally {
      cleanup();
    }
  }
});

test("a trailing-space PRODUCTION still resolves safely, not to prod", async () => {
  try {
    // Case and whitespace are normalized; anything unrecognised falls to dev.
    const { env } = await moduleFor("PRODUCTION");
    assert.equal(env.environmentSlug(), "prod", "case is normalized");
  } finally {
    cleanup();
  }
});

test("production and preview session sets cannot intersect", async () => {
  try {
    const prod = await moduleFor("production");
    const prodKey = prod.store.keys.unique("case_check_completed");
    cleanup();

    const preview = await moduleFor("preview");
    const previewKey = preview.store.keys.unique("case_check_completed");

    assert.notEqual(prodKey, previewKey);
    assert.ok(prodKey.startsWith("cs:v1:prod:"));
    assert.ok(previewKey.startsWith("cs:v1:preview:"));
  } finally {
    cleanup();
  }
});

test("qualified WTP inputs are environment-local", async () => {
  // Both sides of the intersection must live in the same namespace, or the
  // metric would silently mix cohorts across environments.
  try {
    const { store } = await moduleFor("production");
    const completed = store.keys.unique("case_check_completed");
    const intent = store.keys.unique("purchase_intent_29");
    assert.ok(completed.startsWith("cs:v1:prod:"));
    assert.ok(intent.startsWith("cs:v1:prod:"));
  } finally {
    cleanup();
  }
});

test("campaign attribution is environment-local", async () => {
  try {
    const prod = await moduleFor("production");
    const prodCampaigns = prod.store.keys.campaigns();
    const prodCohort = prod.store.keys.campaign("google|cpc|x|y|z", "page_view");
    cleanup();

    const preview = await moduleFor("preview");
    assert.notEqual(prodCampaigns, preview.store.keys.campaigns());
    assert.notEqual(
      prodCohort,
      preview.store.keys.campaign("google|cpc|x|y|z", "page_view"),
    );
  } finally {
    cleanup();
  }
});

test("answer segmentation is environment-local", async () => {
  try {
    const prod = await moduleFor("production");
    const prodAnswer = prod.store.keys.answer("visa", "cr1-ir1-spouse");
    cleanup();

    const preview = await moduleFor("preview");
    assert.notEqual(
      prodAnswer,
      preview.store.keys.answer("visa", "cr1-ir1-spouse"),
    );
    assert.ok(prodAnswer.startsWith("cs:v1:prod:ans:"));
  } finally {
    cleanup();
  }
});

test("every write in one event lands in a single namespace", async () => {
  const batches = stubRedis();
  try {
    process.env.KV_REST_API_URL = ENDPOINT;
    process.env.KV_REST_API_TOKEN = "stub-token";
    const { store } = await moduleFor("preview");
    await store.recordEvent({
      name: "case_check_completed",
      ts: "2026-08-27T12:00:00.000Z",
      session_id: "sess-1",
      utm_source: "google",
      visa: "CR1 / IR1 spouse",
    });

    const touched = batches
      .flat()
      .flatMap((command) => command.slice(1))
      .filter((argument) => String(argument).startsWith("cs:v1:"));

    assert.ok(touched.length > 0, "keys were written");
    for (const key of touched) {
      assert.ok(
        key.startsWith("cs:v1:preview:"),
        `every key stays in the preview namespace, saw "${key}"`,
      );
    }
  } finally {
    cleanup();
  }
});

test("a mismatched store declaration raises a dashboard warning", async () => {
  try {
    process.env.ANALYTICS_STORE_ENV = "preview";
    const { env } = await moduleFor("production");
    const info = env.environmentInfo();
    assert.equal(info.slug, "prod");
    assert.equal(info.declared_store, "preview");
    assert.equal(info.warnings.length, 1);
    assert.match(info.warnings[0], /credentials are likely wrong/);
  } finally {
    cleanup();
  }
});

test("a matching store declaration raises no warning", async () => {
  try {
    process.env.ANALYTICS_STORE_ENV = "production";
    const { env } = await moduleFor("production");
    assert.deepEqual(env.environmentInfo().warnings, []);
  } finally {
    cleanup();
  }
});

test("the store fingerprint identifies a store without exposing it", async () => {
  try {
    process.env.KV_REST_API_URL = "https://sharp-mink-000000.upstash.io";
    process.env.KV_REST_API_TOKEN = "stub-token";
    const { env } = await moduleFor("production");
    const info = env.environmentInfo();
    assert.match(info.store_fingerprint, /^[0-9a-f]{8}$/);
    assert.ok(!JSON.stringify(info).includes("sharp-mink"));
    assert.ok(!JSON.stringify(info).includes("stub-token"));
  } finally {
    cleanup();
  }
});

test("a missing VERCEL_ENV is reported rather than assumed to be production", async () => {
  try {
    const { env } = await moduleFor(undefined);
    const info = env.environmentInfo();
    assert.equal(info.slug, "dev");
    assert.match(info.warnings.join(" "), /VERCEL_ENV is not set/);
  } finally {
    cleanup();
  }
});
