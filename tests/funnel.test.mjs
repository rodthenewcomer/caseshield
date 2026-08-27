import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCampaigns,
  buildCoreFunnel,
  buildQualified,
  rate,
  sampleQuality,
} from "../lib/funnel.mjs";
import {
  CORE_FUNNEL,
  DIAGNOSTIC_EVENTS,
  QUALIFIED_ACTIONS,
} from "../lib/events.mjs";

test("optional actions are not modelled as mandatory funnel stages", () => {
  // alert_intent being in the core chain is what made pricing conversion
  // divide by the wrong denominator.
  assert.ok(!CORE_FUNNEL.includes("alert_intent"));
  assert.ok(!CORE_FUNNEL.includes("pricing_view"));
  assert.ok(!CORE_FUNNEL.includes("purchase_intent_29"));
  assert.ok(DIAGNOSTIC_EVENTS.includes("alert_intent"));
  assert.equal(CORE_FUNNEL.at(-1), "case_check_completed");
});

test("core funnel reports reach and stage-to-stage conversion", () => {
  const core = buildCoreFunnel({
    sessions: 200,
    unique: { page_view: 200, case_check_started: 80, case_check_completed: 40 },
    totals: { page_view: 640 },
  });
  const byName = Object.fromEntries(core.map((step) => [step.name, step]));
  assert.equal(byName.page_view.reach_pct, 100);
  assert.equal(byName.page_view.total_events, 640);
  assert.equal(byName.page_view.step_pct, null, "first stage has no predecessor");
  assert.equal(byName.case_check_started.step_pct, 40);
});

test("qualified WTP counts only intents from sessions that completed", () => {
  // 40 completions, 30 of which also signalled intent. Ten further intents
  // came from visitors who never ran a case check.
  const result = buildQualified({
    completions: 40,
    intersect: { purchase_intent_29: 30, pricing_view: 36, alert_intent: 12 },
    unique: { purchase_intent_29: 40, pricing_view: 90, alert_intent: 12 },
  });

  assert.equal(result.headline.qualified_intents, 30);
  assert.equal(result.headline.qualified_wtp_pct, 75, "30 of 40 completers");
  // The naive ratio would have been 40/40 = 100%.
  assert.notEqual(result.headline.qualified_wtp_pct, 100);
});

test("a non-completer clicking $29 stays out of the numerator", () => {
  const result = buildQualified({
    completions: 10,
    intersect: { purchase_intent_29: 2 },
    unique: { purchase_intent_29: 9 },
  });
  assert.equal(result.headline.qualified_intents, 2);
  assert.equal(result.headline.qualified_wtp_pct, 20);
  // Still visible as real interest, just outside the decision metric.
  assert.equal(result.headline.unqualified_intents, 7);
});

test("duplicate clicks cannot inflate intent", () => {
  // Set semantics upstream mean one session is one member however many times
  // it fires; the intersection can never exceed the completion cohort.
  const result = buildQualified({
    completions: 5,
    intersect: { purchase_intent_29: 5 },
    unique: { purchase_intent_29: 5 },
  });
  assert.equal(result.headline.qualified_wtp_pct, 100);
  assert.equal(result.headline.unqualified_intents, 0);
});

test("skipping alert intent does not break pricing conversion", () => {
  // The exact scenario that previously rendered pricing as "—".
  const result = buildQualified({
    completions: 20,
    intersect: { pricing_view: 15, purchase_intent_29: 4, alert_intent: 0 },
    unique: { pricing_view: 15, purchase_intent_29: 4, alert_intent: 0 },
  });
  assert.equal(result.actions.alert_intent.sessions, 0);
  assert.equal(result.actions.alert_intent.pct, 0);
  assert.equal(result.actions.pricing_view.pct, 75, "still measurable");
  assert.equal(result.headline.qualified_wtp_pct, 20);
});

test("every qualified action is reported against completers", () => {
  const result = buildQualified({ completions: 0 });
  for (const action of QUALIFIED_ACTIONS) {
    assert.ok(action in result.actions, `${action} reported`);
    assert.equal(result.actions[action].pct, null, "no divide by zero");
  }
});

test("campaign cohorts are ranked by unique sessions", () => {
  const rows = buildCampaigns([
    {
      key: "google|cpc|disruption|cancelled|none",
      sessions: 40,
      starts: 20,
      completions: 10,
      qualifiedIntents: 3,
    },
    {
      key: "none|none|none|none|none",
      sessions: 90,
      starts: 5,
      completions: 2,
      qualifiedIntents: 0,
    },
  ]);

  assert.equal(rows[0].sessions, 90, "sorted by session volume");
  assert.equal(rows[0].unattributed, true);

  const paid = rows.find((row) => row.utm_source === "google");
  assert.equal(paid.utm_medium, "cpc");
  assert.equal(paid.utm_content, "cancelled");
  assert.equal(paid.completion_pct, 25);
  assert.equal(paid.qualified_wtp_pct, 30, "3 of 10 completers");
  assert.equal(paid.unattributed, false);
});

test("sample size is labelled honestly", () => {
  assert.equal(sampleQuality(0).label, "directional");
  assert.equal(sampleQuality(19).label, "directional");
  assert.equal(sampleQuality(20).label, "early");
  assert.equal(sampleQuality(99).label, "early");
  assert.equal(sampleQuality(100).label, "decision");
  assert.match(sampleQuality(3).note, /fewer than 20/);
});

test("rate never divides by zero", () => {
  assert.equal(rate(5, 0), null);
  assert.equal(rate(0, 10), 0);
  assert.equal(rate(1, 3), 33.3);
});
