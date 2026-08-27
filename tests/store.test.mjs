import test from "node:test";
import assert from "node:assert/strict";
import {
  FUNNEL_EVENTS,
  buildFunnel,
  checkRateLimit,
  isConfigured,
  recordEvent,
} from "../lib/store.mjs";

test("funnel covers every acquisition event in order", () => {
  assert.equal(FUNNEL_EVENTS[0], "page_view");
  assert.equal(FUNNEL_EVENTS.at(-1), "purchase_intent_29");
  assert.equal(FUNNEL_EVENTS.length, 12);
  assert.equal(new Set(FUNNEL_EVENTS).size, 12, "no duplicate stages");
});

test("reports unconfigured storage instead of throwing", async () => {
  assert.equal(isConfigured(), false);
  const result = await recordEvent({
    name: "page_view",
    ts: new Date().toISOString(),
    session_id: "abc",
  });
  assert.deepEqual(result, { stored: false, reason: "not_configured" });
});

test("computes reach and step-to-step conversion from unique sessions", () => {
  const funnel = buildFunnel({
    sessions: 200,
    unique: {
      page_view: 200,
      hero_cta_click: 100,
      case_check_started: 50,
      case_check_completed: 40,
      purchase_intent_29: 10,
    },
    totals: { page_view: 640 },
  });

  const byName = Object.fromEntries(
    funnel.steps.map((step) => [step.name, step]),
  );
  assert.equal(byName.page_view.reach_pct, 100);
  assert.equal(byName.page_view.total_events, 640);
  // hero_cta_click follows page_view: 100 of 200.
  assert.equal(byName.hero_cta_click.step_pct, 50);
  // The first stage has no predecessor to convert from.
  assert.equal(byName.page_view.step_pct, null);
});

test("headline exposes the completion-to-payment-intent signal", () => {
  const funnel = buildFunnel({
    sessions: 100,
    unique: { case_check_completed: 40, purchase_intent_29: 6 },
  });
  assert.equal(funnel.headline.completions, 40);
  assert.equal(funnel.headline.purchase_intents, 6);
  assert.equal(funnel.headline.completion_to_intent_pct, 15);
});

test("never divides by zero on an empty funnel", () => {
  const funnel = buildFunnel({});
  assert.equal(funnel.sessions, 0);
  assert.equal(funnel.headline.completion_to_intent_pct, null);
  assert.equal(funnel.steps.length, 12);
  assert.ok(funnel.steps.every((step) => step.unique_sessions === 0));
});

test("ignores malformed counts from the store", () => {
  const funnel = buildFunnel({
    sessions: 10,
    unique: { page_view: "not-a-number", hero_cta_click: null },
  });
  const byName = Object.fromEntries(
    funnel.steps.map((step) => [step.name, step]),
  );
  assert.equal(byName.page_view.unique_sessions, 0);
  assert.equal(byName.hero_cta_click.unique_sessions, 0);
});

test("rate limiting fails open when the store is unavailable", async () => {
  // Analytics protection must never take the product down.
  const result = await checkRateLimit("203.0.113.9");
  assert.equal(result.allowed, true);
  assert.equal(result.limited, false);
});
