/**
 * Attribution normalization.
 *
 * Two jobs: keep acquisition data privacy-safe, and keep Redis key space
 * bounded. Ad platforms will happily send arbitrary utm_term values, and an
 * unbounded key space is both a cost problem and an availability problem.
 */

import { CAMPAIGN_DIMENSIONS } from "./events.mjs";

export const SEGMENT_MAX_LENGTH = 32;
export const CAMPAIGN_KEY_SEPARATOR = "|";
/** Beyond this many distinct cohorts, new ones bucket into "other". */
export const MAX_TRACKED_CAMPAIGNS = 200;
export const MAX_TRACKED_ANSWER_VALUES = 120;
export const UNSET = "none";
export const OVERFLOW = "other";

/**
 * Reduce any value to a short, lowercase, delimiter-safe slug.
 * The separator is stripped, so a crafted value cannot forge extra columns.
 */
export function slug(value) {
  const cleaned = String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SEGMENT_MAX_LENGTH)
    .replace(/-+$/g, "");
  return cleaned || UNSET;
}

/**
 * Host only — never the full referrer URL or its query string, which can
 * carry the visitor's original search terms.
 */
export function referrerHost(referrer) {
  const raw = String(referrer ?? "").trim();
  if (!raw) return "";
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
    return /^[a-z0-9.-]{1,80}$/.test(host) ? host : "";
  } catch {
    return "";
  }
}

/**
 * Classify traffic when no campaign parameters are present, so "unattributed"
 * never silently means "direct".
 */
export function classifyTraffic({ utm_source, utm_medium, referrer_host }) {
  if (utm_source || utm_medium) return "campaign";
  if (!referrer_host) return "direct";
  if (/(^|\.)(google|bing|duckduckgo|yahoo|ecosia|brave)\./.test(referrer_host))
    return "organic";
  return "referral";
}

/** Stable cohort key. Fixed arity, so parsing back is unambiguous. */
export function campaignKey(attribution = {}) {
  return CAMPAIGN_DIMENSIONS.map((field) => slug(attribution[field])).join(
    CAMPAIGN_KEY_SEPARATOR,
  );
}

export function parseCampaignKey(key) {
  const parts = String(key).split(CAMPAIGN_KEY_SEPARATOR);
  return Object.fromEntries(
    CAMPAIGN_DIMENSIONS.map((field, index) => [field, parts[index] || UNSET]),
  );
}

/** True when a cohort carries no campaign information at all. */
export function isUnattributed(key) {
  return CAMPAIGN_DIMENSIONS.every(
    (_, index) => String(key).split(CAMPAIGN_KEY_SEPARATOR)[index] === UNSET,
  );
}
