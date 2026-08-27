import test from "node:test";
import assert from "node:assert/strict";

/**
 * The client attribution module reads browser globals. Stub them before
 * importing so first-touch behaviour can be tested without a browser.
 */
function browser({ search = "", referrer = "", hostname = "caseshield-validation.vercel.app" } = {}) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  globalThis.location = { search, hostname };
  globalThis.document = { referrer };
  return store;
}

const CAMPAIGN_URL =
  "?utm_source=google&utm_medium=cpc&utm_campaign=interview_disruption" +
  "&utm_content=cancelled&utm_term=immigrant%20visa%20interview%20cancelled";

async function freshModule() {
  // Cache-bust so each test observes a clean module instance.
  return import(`../acquisition.js?v=${Math.random()}`);
}

test("captures campaign parameters on first landing", async () => {
  browser({ search: CAMPAIGN_URL, referrer: "https://www.google.com/search?q=x" });
  const { attributionPayload } = await freshModule();

  const payload = attributionPayload();
  assert.equal(payload.utm_source, "google");
  assert.equal(payload.utm_medium, "cpc");
  assert.equal(payload.utm_campaign, "interview_disruption");
  assert.equal(payload.utm_content, "cancelled");
  assert.equal(payload.utm_term, "immigrant visa interview cancelled");
  assert.equal(payload.referrer_host, "google.com");
});

test("never stores the full referrer URL or its query string", async () => {
  browser({ referrer: "https://www.google.com/search?q=my+private+search" });
  const { getFirstTouch } = await freshModule();

  const serialized = JSON.stringify(getFirstTouch());
  assert.ok(!serialized.includes("my+private+search"));
  assert.ok(!serialized.includes("/search"));
  assert.ok(serialized.includes("google.com"));
});

test("first touch is not overwritten by a later direct visit", async () => {
  const store = browser({ search: CAMPAIGN_URL });
  const first = await freshModule();
  first.getFirstTouch();

  // Same storage, but the visitor now returns with no campaign parameters.
  globalThis.location = { search: "", hostname: "caseshield-validation.vercel.app" };
  globalThis.document = { referrer: "" };
  const second = await freshModule();

  const payload = second.attributionPayload();
  assert.equal(payload.utm_source, "google", "the ad keeps the credit");
  assert.equal(payload.utm_campaign, "interview_disruption");
  assert.ok(store.size > 0);
});

test("classifies traffic when no campaign parameters are present", async () => {
  browser({ referrer: "" });
  const direct = await freshModule();
  assert.equal(direct.getFirstTouch().channel, "direct");

  browser({ referrer: "https://duckduckgo.com/?q=visa" });
  const organic = await freshModule();
  assert.equal(organic.getFirstTouch().channel, "organic");

  browser({ referrer: "https://www.reddit.com/r/immigration" });
  const referral = await freshModule();
  assert.equal(referral.getFirstTouch().channel, "referral");
});

test("internal navigation is not counted as a referral", async () => {
  browser({
    referrer: "https://caseshield-validation.vercel.app/privacy.html",
    hostname: "caseshield-validation.vercel.app",
  });
  const { getFirstTouch } = await freshModule();
  const touch = getFirstTouch();
  assert.equal(touch.referrer_host, undefined);
  assert.equal(touch.channel, "direct");
});

test("hero copy is chosen from a trusted enum, never from raw UTM text", async () => {
  browser({ search: "?utm_content=cancelled" });
  const safe = await freshModule();
  assert.equal(safe.heroVariant(), "cancelled");

  browser({ search: "?utm_content=%3Cscript%3Ealert(1)%3C/script%3E" });
  const hostile = await freshModule();
  assert.equal(hostile.heroVariant(), null, "unknown values render nothing");

  browser({ search: "?utm_content=some_other_campaign" });
  const unknown = await freshModule();
  assert.equal(unknown.heroVariant(), null);
});

test("survives storage being unavailable", async () => {
  browser({ search: CAMPAIGN_URL });
  globalThis.localStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  const { attributionPayload } = await freshModule();
  assert.equal(attributionPayload().utm_source, "google");
});
