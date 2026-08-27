/**
 * Validation event write path.
 *
 * Unique-session SETs are the source of truth. Raw counters exist only for
 * diagnostics: one visitor producing ten events must never read as ten people.
 *
 * Every call degrades to a no-op when unconfigured or unreachable — analytics
 * must never take the public product down.
 */

import { isConfigured, pipeline, toCount } from "./redis.mjs";
import {
  ANSWER_FIELDS,
  ATTRIBUTION_FIELDS,
  CAMPAIGN_DIMENSIONS,
} from "./events.mjs";
import {
  MAX_TRACKED_ANSWER_VALUES,
  MAX_TRACKED_CAMPAIGNS,
  OVERFLOW,
  campaignKey,
  slug,
} from "./attribution.mjs";

export { isConfigured };

export const KEY_PREFIX = "cs:v1";
export const RECENT_MAX = 500;
export const DAY_TTL_SECONDS = 90 * 24 * 60 * 60;
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_EVENTS = 90;

/** Cohort membership is only tracked for stages that drive decisions. */
const CAMPAIGN_TRACKED_EVENTS = new Set([
  "page_view",
  "case_check_started",
  "case_check_completed",
  "purchase_intent_29",
]);

export const keys = {
  sessions: `${KEY_PREFIX}:sessions`,
  unique: (event) => `${KEY_PREFIX}:uniq:${event}`,
  count: (event) => `${KEY_PREFIX}:count:${event}`,
  day: (day, event) => `${KEY_PREFIX}:day:${day}:uniq:${event}`,
  recent: `${KEY_PREFIX}:recent`,
  campaigns: `${KEY_PREFIX}:campaigns`,
  campaign: (key, event) => `${KEY_PREFIX}:camp:${key}:${event}`,
  answerValues: (field) => `${KEY_PREFIX}:answers:${field}`,
  answer: (field, value) => `${KEY_PREFIX}:ans:${field}:${value}`,
};

/**
 * Per-IP rate limit. Persistence turned spam from log noise into a
 * data-integrity problem. Fails OPEN so the product survives a store outage.
 */
export async function checkRateLimit(clientId) {
  if (!isConfigured() || !clientId) return { allowed: true, limited: false };

  const window = Math.floor(Date.now() / 1000 / RATE_LIMIT_WINDOW_SECONDS);
  const key = `${KEY_PREFIX}:rl:${window}:${clientId}`;
  try {
    const results = await pipeline([
      ["INCR", key],
      ["EXPIRE", key, RATE_LIMIT_WINDOW_SECONDS * 2],
    ]);
    const hits = toCount(results?.[0]);
    return { allowed: hits <= RATE_LIMIT_MAX_EVENTS, limited: true, hits };
  } catch {
    return { allowed: true, limited: false };
  }
}

function attributionOf(event) {
  return Object.fromEntries(
    ATTRIBUTION_FIELDS.map((field) => [field, event[field]]),
  );
}

/**
 * Cohort and answer registries are capped. Ad platforms emit arbitrary
 * utm_term values, and an unbounded key space is a cost and availability risk.
 *
 * All membership checks are resolved in ONE pipeline: doing them per field
 * cost a separate HTTP round trip each, which added latency to exactly the
 * event that matters most (completion).
 */
function registryLookups(event) {
  const lookups = [];

  if (CAMPAIGN_TRACKED_EVENTS.has(event.name)) {
    const attribution = attributionOf(event);
    const hasCampaign = CAMPAIGN_DIMENSIONS.some((field) => attribution[field]);
    lookups.push({
      kind: "campaign",
      registry: keys.campaigns,
      member: campaignKey(attribution),
      cap: MAX_TRACKED_CAMPAIGNS,
      // An empty cohort is a fixed bucket, so it never needs capping.
      skipCap: !hasCampaign,
    });
  }

  for (const field of ANSWER_FIELDS) {
    const value = event[field];
    if (!value || value === "[redacted]") continue;
    lookups.push({
      kind: "answer",
      field,
      registry: keys.answerValues(field),
      member: slug(value),
      cap: MAX_TRACKED_ANSWER_VALUES,
      skipCap: false,
    });
  }

  return lookups;
}

/** Resolve every registry membership question in a single round trip. */
async function resolveMembers(lookups) {
  const capped = lookups.filter((lookup) => !lookup.skipCap);
  if (!capped.length) return lookups.map((lookup) => lookup.member);

  const results = await pipeline(
    capped.flatMap((lookup) => [
      ["SISMEMBER", lookup.registry, lookup.member],
      ["SCARD", lookup.registry],
    ]),
  );

  let index = 0;
  return lookups.map((lookup) => {
    if (lookup.skipCap) return lookup.member;
    const known = toCount(results?.[index * 2]) === 1;
    const size = toCount(results?.[index * 2 + 1]);
    index += 1;
    if (known) return lookup.member;
    return size >= lookup.cap ? OVERFLOW : lookup.member;
  });
}

/** Persist one validated event. */
export async function recordEvent(event) {
  if (!isConfigured()) return { stored: false, reason: "not_configured" };

  const day = String(event.ts || "").slice(0, 10);
  const dayKey = keys.day(day, event.name);

  try {
    const lookups = registryLookups(event);
    const members = await resolveMembers(lookups);

    const segments = lookups.flatMap((lookup, index) => {
      const member = members[index];
      if (lookup.kind === "campaign") {
        return [
          ["SADD", keys.campaigns, member],
          ["SADD", keys.campaign(member, event.name), event.session_id],
        ];
      }
      return [
        ["SADD", lookup.registry, member],
        ["SADD", keys.answer(lookup.field, member), event.session_id],
      ];
    });

    await pipeline([
      ["SADD", keys.unique(event.name), event.session_id],
      ["INCR", keys.count(event.name)],
      ["SADD", keys.sessions, event.session_id],
      ["SADD", dayKey, event.session_id],
      ["EXPIRE", dayKey, DAY_TTL_SECONDS],
      ["LPUSH", keys.recent, JSON.stringify(event)],
      ["LTRIM", keys.recent, 0, RECENT_MAX - 1],
      ...segments,
    ]);
    return { stored: true };
  } catch (error) {
    console.error("CASESHIELD_STORE_ERROR", String(error?.message || error));
    return { stored: false, reason: "store_unavailable" };
  }
}
