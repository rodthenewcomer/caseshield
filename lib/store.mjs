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

/**
 * Cohort and answer registries are capped. Ad platforms emit arbitrary
 * utm_term values, and an unbounded key space is a cost and availability risk.
 */
async function withinRegistryCap(registryKey, member, cap) {
  const results = await pipeline([
    ["SISMEMBER", registryKey, member],
    ["SCARD", registryKey],
  ]);
  if (toCount(results?.[0]) === 1) return member;
  return toCount(results?.[1]) >= cap ? OVERFLOW : member;
}

function attributionOf(event) {
  return Object.fromEntries(
    ATTRIBUTION_FIELDS.map((field) => [field, event[field]]),
  );
}

/** Commands recording which acquisition cohort a session belongs to. */
async function campaignCommands(event) {
  if (!CAMPAIGN_TRACKED_EVENTS.has(event.name)) return [];

  const attribution = attributionOf(event);
  const hasCampaign = CAMPAIGN_DIMENSIONS.some((field) => attribution[field]);
  const raw = campaignKey(attribution);
  const key = hasCampaign
    ? await withinRegistryCap(keys.campaigns, raw, MAX_TRACKED_CAMPAIGNS)
    : raw;

  return [
    ["SADD", keys.campaigns, key],
    ["SADD", keys.campaign(key, event.name), event.session_id],
  ];
}

/** Commands recording the answer mix as unique sessions, not event counts. */
async function answerCommands(event) {
  const commands = [];
  for (const field of ANSWER_FIELDS) {
    const value = event[field];
    if (!value || value === "[redacted]") continue;

    const normalized = await withinRegistryCap(
      keys.answerValues(field),
      slug(value),
      MAX_TRACKED_ANSWER_VALUES,
    );
    commands.push(
      ["SADD", keys.answerValues(field), normalized],
      ["SADD", keys.answer(field, normalized), event.session_id],
    );
  }
  return commands;
}

/** Persist one validated event. */
export async function recordEvent(event) {
  if (!isConfigured()) return { stored: false, reason: "not_configured" };

  const day = String(event.ts || "").slice(0, 10);
  const dayKey = keys.day(day, event.name);

  try {
    const extra = [
      ...(await campaignCommands(event)),
      ...(await answerCommands(event)),
    ];
    await pipeline([
      ["SADD", keys.unique(event.name), event.session_id],
      ["INCR", keys.count(event.name)],
      ["SADD", keys.sessions, event.session_id],
      ["SADD", dayKey, event.session_id],
      ["EXPIRE", dayKey, DAY_TTL_SECONDS],
      ["LPUSH", keys.recent, JSON.stringify(event)],
      ["LTRIM", keys.recent, 0, RECENT_MAX - 1],
      ...extra,
    ]);
    return { stored: true };
  } catch (error) {
    console.error("CASESHIELD_STORE_ERROR", String(error?.message || error));
    return { stored: false, reason: "store_unavailable" };
  }
}
