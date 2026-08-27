import { createHash, timingSafeEqual } from "node:crypto";
import { readFunnel } from "../lib/store.mjs";

/**
 * Internal validation funnel API.
 *
 * Business metrics are not public. This route fails closed: without
 * VALIDATION_TOKEN configured it serves nothing at all.
 */

function fingerprint(value) {
  return createHash("sha256").update(String(value)).digest();
}

/** Constant-time compare over fixed-width digests. */
function tokenMatches(provided, expected) {
  if (!provided || !expected) return false;
  return timingSafeEqual(fingerprint(provided), fingerprint(expected));
}

function bearer(req) {
  const header = String(req.headers?.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function respond(res, status, payload) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  return res.status(status).json(payload);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return respond(res, 405, { ok: false, error: "method_not_allowed" });
  }

  const expected = process.env.VALIDATION_TOKEN;
  if (!expected) {
    return respond(res, 503, { ok: false, error: "dashboard_not_configured" });
  }

  if (!tokenMatches(bearer(req), expected)) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="caseshield-validation"');
    return respond(res, 401, { ok: false, error: "unauthorized" });
  }

  try {
    const funnel = await readFunnel();
    return respond(res, 200, { ok: true, ...funnel });
  } catch (error) {
    console.error("CASESHIELD_FUNNEL_ERROR", String(error?.message || error));
    return respond(res, 502, { ok: false, error: "store_unavailable" });
  }
}
