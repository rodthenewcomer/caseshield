import test from "node:test";
import assert from "node:assert/strict";
import {
  checkRateLimit,
  isConfigured,
  keys,
  recordEvent,
} from "../lib/store.mjs";
import {
  MAX_TRACKED_ANSWER_VALUES,
  MAX_TRACKED_CAMPAIGNS,
} from "../lib/attribution.mjs";

test("storage degrades gracefully when unconfigured", async () => {
  assert.equal(isConfigured(), false);
  const result = await recordEvent({
    name: "page_view",
    ts: new Date().toISOString(),
    session_id: "abcd1234efgh",
  });
  assert.deepEqual(result, { stored: false, reason: "not_configured" });
});

test("rate limiting fails open so analytics cannot break the product", async () => {
  const result = await checkRateLimit("203.0.113.9");
  assert.equal(result.allowed, true);
  assert.equal(result.limited, false);
});

test("keys are namespaced and versioned", () => {
  assert.equal(keys.unique("page_view"), "cs:v1:uniq:page_view");
  assert.equal(keys.count("page_view"), "cs:v1:count:page_view");
  assert.equal(
    keys.campaign("google|cpc|x|y|z", "case_check_completed"),
    "cs:v1:camp:google|cpc|x|y|z:case_check_completed",
  );
  assert.equal(keys.answer("visa", "cr1-ir1-spouse"), "cs:v1:ans:visa:cr1-ir1-spouse");
});

test("segment registries are capped against key explosion", () => {
  // Ad platforms emit arbitrary utm_term values; an unbounded key space is
  // both a cost and an availability risk.
  assert.ok(MAX_TRACKED_CAMPAIGNS > 0 && MAX_TRACKED_CAMPAIGNS <= 1000);
  assert.ok(MAX_TRACKED_ANSWER_VALUES > 0 && MAX_TRACKED_ANSWER_VALUES <= 1000);
});
