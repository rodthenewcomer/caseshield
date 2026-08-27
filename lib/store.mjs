/**
 * Validation event store (Upstash Redis over its REST API).
 *
 * Deliberately dependency-free: the REST endpoint is a plain fetch, which keeps
 * the build free of runtime packages and works in any serverless runtime.
 *
 * Analytics must never break the product. Every call degrades to a no-op when
 * credentials are absent or the store is unreachable.
 */

export const KEY_PREFIX = "cs:v1";
export const RECENT_MAX = 500;
export const DAY_TTL_SECONDS = 90 * 24 * 60 * 60;
const WRITE_TIMEOUT_MS = 2_000;
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_EVENTS = 90;
const READ_TIMEOUT_MS = 4_000;

/** Canonical funnel order — the sequence a qualified visitor moves through. */
export const FUNNEL_EVENTS = [
  "page_view",
  "hero_cta_click",
  "case_check_started",
  "case_step_1",
  "case_step_2",
  "case_step_3",
  "case_step_4",
  "case_step_5",
  "case_check_completed",
  "alert_intent",
  "pricing_view",
  "purchase_intent_29",
];

/**
 * Marketplace Upstash injects KV_REST_API_*; a direct Upstash account injects
 * UPSTASH_REDIS_REST_*. Accept either so provisioning path does not matter.
 */
function credentials() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

export function isConfigured() {
  return credentials() !== null;
}

async function pipeline(commands, timeoutMs) {
  const creds = credentials();
  if (!creds) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${creds.url}/pipeline`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${creds.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(commands),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`upstash_http_${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Per-IP rate limit.
 *
 * Persistence turned spam from a log nuisance into a data-integrity problem:
 * a flooded funnel would give false confidence in a go/kill decision. Fails
 * OPEN — if the store is unreachable the product keeps working.
 */
export async function checkRateLimit(clientId) {
  if (!isConfigured() || !clientId) return { allowed: true, limited: false };

  const window = Math.floor(Date.now() / 1000 / RATE_LIMIT_WINDOW_SECONDS);
  const key = `${KEY_PREFIX}:rl:${window}:${clientId}`;
  try {
    const results = await pipeline(
      [
        ["INCR", key],
        ["EXPIRE", key, RATE_LIMIT_WINDOW_SECONDS * 2],
      ],
      WRITE_TIMEOUT_MS,
    );
    const hits = Number(results?.[0]?.result || 0);
    return { allowed: hits <= RATE_LIMIT_MAX_EVENTS, limited: true, hits };
  } catch {
    return { allowed: true, limited: false };
  }
}

/**
 * Persist one validated event.
 *
 * Unique-session sets are the funnel's source of truth: a visitor who reloads
 * five times must not read as five conversions.
 */
export async function recordEvent(event) {
  if (!isConfigured()) return { stored: false, reason: "not_configured" };

  const day = String(event.ts || "").slice(0, 10);
  const dayKey = `${KEY_PREFIX}:day:${day}:uniq:${event.name}`;

  try {
    await pipeline(
      [
        ["SADD", `${KEY_PREFIX}:uniq:${event.name}`, event.session_id],
        ["INCR", `${KEY_PREFIX}:count:${event.name}`],
        ["SADD", `${KEY_PREFIX}:sessions`, event.session_id],
        ["SADD", dayKey, event.session_id],
        ["EXPIRE", dayKey, DAY_TTL_SECONDS],
        ["LPUSH", `${KEY_PREFIX}:recent`, JSON.stringify(event)],
        ["LTRIM", `${KEY_PREFIX}:recent`, 0, RECENT_MAX - 1],
      ],
      WRITE_TIMEOUT_MS,
    );
    return { stored: true };
  } catch (error) {
    // Never surface a store failure to the visitor.
    console.error("CASESHIELD_STORE_ERROR", String(error?.message || error));
    return { stored: false, reason: "store_unavailable" };
  }
}

function toCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function rate(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/**
 * Pure funnel math, separated from I/O so it is testable without a network.
 *
 * `reach` is share of all known sessions; `step` is conversion from the
 * previous funnel stage — the number that tells you where visitors drop.
 */
export function buildFunnel({ unique = {}, totals = {}, sessions = 0 } = {}) {
  let previous = null;
  const steps = FUNNEL_EVENTS.map((name) => {
    const uniqueSessions = toCount(unique[name]);
    const step = {
      name,
      unique_sessions: uniqueSessions,
      total_events: toCount(totals[name]),
      reach_pct: rate(uniqueSessions, sessions),
      step_pct: previous === null ? null : rate(uniqueSessions, previous),
    };
    previous = uniqueSessions;
    return step;
  });

  const byName = Object.fromEntries(steps.map((step) => [step.name, step]));
  const completed = byName.case_check_completed.unique_sessions;
  const intent = byName.purchase_intent_29.unique_sessions;

  return {
    sessions,
    steps,
    headline: {
      // The kill-or-continue signal: of people who finish, who wants to pay?
      completion_to_intent_pct: rate(intent, completed),
      completions: completed,
      purchase_intents: intent,
      alert_intents: byName.alert_intent.unique_sessions,
    },
  };
}

/** Read the funnel plus a recent-event sample for segment analysis. */
export async function readFunnel() {
  if (!isConfigured()) {
    return { configured: false, ...buildFunnel({}), recent: [] };
  }

  const commands = [
    ...FUNNEL_EVENTS.map((name) => ["SCARD", `${KEY_PREFIX}:uniq:${name}`]),
    ...FUNNEL_EVENTS.map((name) => ["GET", `${KEY_PREFIX}:count:${name}`]),
    ["SCARD", `${KEY_PREFIX}:sessions`],
    ["LRANGE", `${KEY_PREFIX}:recent`, 0, 99],
  ];

  const results = await pipeline(commands, READ_TIMEOUT_MS);
  const values = (results || []).map((entry) => entry?.result);
  const size = FUNNEL_EVENTS.length;

  const unique = {};
  const totals = {};
  FUNNEL_EVENTS.forEach((name, index) => {
    unique[name] = values[index];
    totals[name] = values[index + size];
  });

  const recent = (values[size * 2 + 1] || [])
    .map((raw) => {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return {
    configured: true,
    ...buildFunnel({ unique, totals, sessions: toCount(values[size * 2]) }),
    recent,
  };
}
