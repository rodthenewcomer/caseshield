import { checkRateLimit, recordEvent } from "../lib/store.mjs";
import { ALLOWED_EVENTS, ALLOWED_FIELDS } from "../lib/events.mjs";
import { referrerHost } from "../lib/attribution.mjs";

const MAX_BODY_BYTES = 4_096;
const MAX_FIELD_LENGTH = 90;
const MAX_ATTRIBUTION_LENGTH = 60;

/** Fields that could carry a case number if a URL or input is crafted. */
const DIGIT_SENSITIVE = new Set([
  "embassy",
  "answer",
  "utm_term",
  "utm_content",
  "utm_campaign",
]);

function clean(value, max = MAX_FIELD_LENGTH) {
  return String(value ?? "")
    .replace(/[<>\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function cleanSessionId(value) {
  const id = clean(value, 64);
  return /^[a-zA-Z0-9-]{8,64}$/.test(id) ? id : "invalid";
}

function isSameOrigin(req) {
  // Browsers always send Sec-Fetch-Site; a cross-site caller is never valid
  // here, even when it omits Origin.
  if (String(req.headers?.["sec-fetch-site"] || "") === "cross-site") {
    return false;
  }
  const origin = req.headers?.origin;
  // A missing Origin (curl, server-side probes) stays allowed: this endpoint
  // only appends to an analytics log and mutates no user state.
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      parsed.host === req.headers?.host
    );
  } catch (_error) {
    return false;
  }
}

function readBody(req) {
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body))
    return req.body;
  if (typeof req.body !== "string") return null;
  try {
    const parsed = JSON.parse(req.body);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch (_error) {
    return null;
  }
}

function respond(res, status, payload) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(status).json(payload);
}

/**
 * Build the stored event from an allowlist. Unknown fields are dropped rather
 * than passed through, and anything resembling a case identifier is redacted
 * before it can reach the log or the store.
 */
function buildEvent(body) {
  const event = {
    name: body.name,
    ts: new Date().toISOString(),
    session_id: cleanSessionId(body.session_id),
  };

  for (const key of ALLOWED_FIELDS) {
    if (body[key] === undefined) continue;

    if (key === "referrer_host") {
      // Host only — a full referrer URL can carry the visitor's search terms.
      const raw = clean(body[key], 80);
      const host = referrerHost(raw.includes("://") ? raw : `https://${raw}`);
      if (host) event[key] = host;
      continue;
    }

    const isAttribution = key.startsWith("utm_");
    const value = clean(
      body[key],
      isAttribution ? MAX_ATTRIBUTION_LENGTH : MAX_FIELD_LENGTH,
    );
    if (!value) continue;

    const looksLikeCaseNumber =
      DIGIT_SENSITIVE.has(key) &&
      /\d{5,}/.test(value) &&
      (key !== "answer" || body.step_id === "embassy");
    event[key] = looksLikeCaseNumber ? "[redacted]" : value;
  }

  return event;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return respond(res, 405, { ok: false, error: "method_not_allowed" });
  }

  const contentType = String(req.headers?.["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    return respond(res, 415, { ok: false, error: "unsupported_media_type" });
  }

  const contentLength = Number(req.headers?.["content-length"] || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return respond(res, 413, { ok: false, error: "payload_too_large" });
  }
  const measuredSize =
    typeof req.body === "string"
      ? Buffer.byteLength(req.body, "utf8")
      : Buffer.byteLength(JSON.stringify(req.body || {}), "utf8");
  if (measuredSize > MAX_BODY_BYTES) {
    return respond(res, 413, { ok: false, error: "payload_too_large" });
  }

  if (!isSameOrigin(req)) {
    return respond(res, 403, { ok: false, error: "origin_not_allowed" });
  }

  const body = readBody(req);
  if (!body || !ALLOWED_EVENTS.has(body.name)) {
    return respond(res, 400, { ok: false, error: "invalid_event" });
  }

  const event = buildEvent(body);

  // Cheap validation runs first so junk never costs a store round-trip.
  const clientId = String(req.headers?.["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  const rate = await checkRateLimit(clientId);
  if (!rate.allowed) {
    res.setHeader("Retry-After", "60");
    return respond(res, 429, { ok: false, error: "rate_limited" });
  }

  // Structured log stays as a durable-store-independent audit trail.
  console.log("CASESHIELD_EVENT", JSON.stringify(event));

  // A store outage must never fail the visitor's request.
  const persisted = await recordEvent(event);

  return respond(res, 200, { ok: true, stored: persisted.stored });
}
