import test from "node:test";
import assert from "node:assert/strict";
import {
  CAMPAIGN_KEY_SEPARATOR,
  UNSET,
  campaignKey,
  classifyTraffic,
  isUnattributed,
  parseCampaignKey,
  referrerHost,
  slug,
} from "../lib/attribution.mjs";
import { ALLOWED_FIELDS, ATTRIBUTION_FIELDS } from "../lib/events.mjs";

test("attribution values are normalized to bounded slugs", () => {
  assert.equal(slug("Google CPC"), "google-cpc");
  assert.equal(slug("fiancé(e)"), "fiance-e");
  assert.equal(slug("  "), UNSET);
  assert.equal(slug(null), UNSET);
  assert.ok(slug("a".repeat(200)).length <= 32, "length is capped");
});

test("a crafted value cannot forge extra campaign columns", () => {
  // The separator must not survive normalization, or a single utm_source
  // could inject its own medium and campaign.
  const forged = slug(`evil${CAMPAIGN_KEY_SEPARATOR}cpc${CAMPAIGN_KEY_SEPARATOR}x`);
  assert.ok(!forged.includes(CAMPAIGN_KEY_SEPARATOR));

  const key = campaignKey({ utm_source: "a|b|c|d|e|f" });
  assert.equal(key.split(CAMPAIGN_KEY_SEPARATOR).length, 5, "fixed arity");
});

test("campaign keys round-trip through parsing", () => {
  const attribution = {
    utm_source: "google",
    utm_medium: "cpc",
    utm_campaign: "interview_disruption",
    utm_content: "cancelled",
    utm_term: "immigrant visa interview cancelled",
  };
  const parsed = parseCampaignKey(campaignKey(attribution));
  assert.equal(parsed.utm_source, "google");
  assert.equal(parsed.utm_medium, "cpc");
  assert.equal(parsed.utm_campaign, "interview-disruption");
  assert.equal(parsed.utm_content, "cancelled");
  assert.equal(parsed.utm_term, "immigrant-visa-interview-cancell");
});

test("a fully empty cohort is recognised as unattributed", () => {
  assert.equal(isUnattributed(campaignKey({})), true);
  assert.equal(isUnattributed(campaignKey({ utm_source: "google" })), false);
});

test("only the referrer host is kept, never the query string", () => {
  // A search referrer URL can carry the visitor's own search terms.
  assert.equal(
    referrerHost("https://www.google.com/search?q=my+private+case+details"),
    "google.com",
  );
  assert.equal(referrerHost("https://news.example.org/a/b"), "news.example.org");
  assert.equal(referrerHost("not a url"), "");
  assert.equal(referrerHost(""), "");
});

test("traffic without campaign parameters is classified honestly", () => {
  assert.equal(classifyTraffic({}), "direct");
  assert.equal(classifyTraffic({ referrer_host: "google.com" }), "organic");
  assert.equal(classifyTraffic({ referrer_host: "reddit.com" }), "referral");
  assert.equal(classifyTraffic({ utm_source: "google" }), "campaign");
});

test("the endpoint allowlist covers attribution and nothing arbitrary", () => {
  for (const field of ATTRIBUTION_FIELDS) {
    assert.ok(ALLOWED_FIELDS.includes(field), `${field} is accepted`);
  }
  // Identifiers and raw URLs must never be accepted.
  for (const forbidden of [
    "referrer",
    "referrer_url",
    "gclid",
    "email",
    "ip",
    "user_id",
    "case_number",
  ]) {
    assert.ok(!ALLOWED_FIELDS.includes(forbidden), `${forbidden} is rejected`);
  }
});
