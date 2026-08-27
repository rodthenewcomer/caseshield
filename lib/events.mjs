/**
 * Canonical event vocabulary, shared by the endpoint and the store.
 *
 * The funnel is deliberately NOT one flat sequence. Treating optional actions
 * as mandatory stages produces conversion rates that divide by the wrong
 * denominator, which is how a validation dashboard lies to its owner.
 */

/** Stages every qualified visitor must pass through, in order. */
export const CORE_FUNNEL = [
  "page_view",
  "case_check_started",
  "case_step_1",
  "case_step_2",
  "case_step_3",
  "case_step_4",
  "case_step_5",
  "case_check_completed",
];

/**
 * Real, meaningful actions that are NOT mandatory stages. A visitor can skip
 * alert intent entirely and still view pricing and signal willingness to pay.
 */
export const DIAGNOSTIC_EVENTS = [
  "hero_cta_click",
  "alert_intent",
  "pricing_view",
  "result_offer_click",
  "purchase_intent_29",
];

export const ALL_EVENTS = [...CORE_FUNNEL, ...DIAGNOSTIC_EVENTS];
export const ALLOWED_EVENTS = new Set(ALL_EVENTS);

/**
 * Actions measured as a share of completers rather than of everyone.
 * Each is reported as |completed ∩ action| / |completed|.
 */
export const QUALIFIED_ACTIONS = [
  "pricing_view",
  "result_offer_click",
  "alert_intent",
  "purchase_intent_29",
];

/** The single decision metric. */
export const QUALIFIED_WTP_ACTION = "purchase_intent_29";

/** Assessment answers, all bounded enums except embassy. */
export const ANSWER_FIELDS = ["event", "visa", "timing", "need", "embassy"];

/** First-touch acquisition attribution. Never a full URL or query string. */
export const ATTRIBUTION_FIELDS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "referrer_host",
];

/** Dimensions shown as an acquisition cohort table. */
export const CAMPAIGN_DIMENSIONS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
];

/** Everything the endpoint will accept beyond name and session_id. */
export const ALLOWED_FIELDS = [
  "source",
  "step_id",
  "answer",
  ...ANSWER_FIELDS,
  ...ATTRIBUTION_FIELDS,
];

/** Sample counts below which results must be labelled as non-decisional. */
export const SAMPLE_THRESHOLDS = { directional: 20, decision: 100 };
