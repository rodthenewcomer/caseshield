/**
 * First-touch acquisition attribution.
 *
 * Captured once and never overwritten: if a visitor arrives from an ad, leaves
 * and returns directly, the ad still deserves the credit. Overwriting on the
 * second visit would silently reassign conversions to "direct".
 *
 * Only campaign parameters and the referrer HOST are kept. The full referrer
 * URL is never stored — its query string can carry the visitor's own search
 * terms, which is exactly the kind of data this product promises not to hold.
 */

const STORAGE_KEY = "caseshield_first_touch";
const MAX_LENGTH = 60;

export const UTM_FIELDS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
];

/** Only these map to alternate hero copy; anything else uses the default. */
export const SAFE_CONTENT_VARIANTS = new Set([
  "cancelled",
  "rescheduled",
  "no_date",
  "nvc_delay",
]);

function clean(value) {
  return String(value ?? "")
    .replace(/[<>\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LENGTH);
}

function referrerHost() {
  try {
    const referrer = document.referrer;
    if (!referrer) return "";
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
    // Internal navigation is not a referral.
    if (host === location.hostname.replace(/^www\./, "")) return "";
    return /^[a-z0-9.-]{1,80}$/.test(host) ? host : "";
  } catch {
    return "";
  }
}

function capture() {
  const params = new URLSearchParams(location.search);
  const touch = { captured_at: new Date().toISOString() };

  for (const field of UTM_FIELDS) {
    const value = clean(params.get(field));
    if (value) touch[field] = value;
  }

  const host = referrerHost();
  if (host) touch.referrer_host = host;

  touch.channel = touch.utm_source || touch.utm_medium
    ? "campaign"
    : host
      ? /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|brave)\./.test(host)
        ? "organic"
        : "referral"
      : "direct";

  return touch;
}

/** Read the stored first touch, capturing it on the very first visit only. */
export function getFirstTouch() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved && saved.captured_at) return saved;
  } catch {
    // Private-mode browsers fall through to a per-visit capture.
  }

  const fresh = capture();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
  } catch {
    // Attribution is best-effort; never block the product.
  }
  return fresh;
}

/** The subset attached to analytics events. Empty values are omitted. */
export function attributionPayload() {
  const touch = getFirstTouch();
  const payload = {};
  for (const field of UTM_FIELDS) {
    if (touch[field]) payload[field] = touch[field];
  }
  if (touch.referrer_host) payload.referrer_host = touch.referrer_host;
  return payload;
}

/**
 * Message match for paid search. Returns a trusted enum value or null —
 * arbitrary UTM text is never rendered as copy.
 */
export function heroVariant() {
  const content = getFirstTouch().utm_content;
  return SAFE_CONTENT_VARIANTS.has(content) ? content : null;
}
