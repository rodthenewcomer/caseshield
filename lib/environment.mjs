import { createHash } from "node:crypto";

/**
 * Logical environment for analytics isolation.
 *
 * Preview and production analytics must never mix. Even with separate stores,
 * keys are namespaced by environment so a misconfigured credential cannot
 * silently contaminate the dataset that decides whether to fund this company.
 */

/**
 * Fixed enum. VERCEL_ENV is platform-controlled, but it is never interpolated
 * into a Redis key directly — an unrecognised value resolves to "dev" rather
 * than becoming key material of its own.
 */
const SLUGS = Object.freeze({
  production: "prod",
  preview: "preview",
  development: "dev",
});

const LABELS = Object.freeze({
  prod: "Production",
  preview: "Preview",
  dev: "Development",
});

export const DEFAULT_SLUG = "dev";

function rawEnvironment() {
  return String(process.env.VERCEL_ENV || "")
    .trim()
    .toLowerCase();
}

/** "prod" | "preview" | "dev" — never anything else. */
export function environmentSlug() {
  const raw = rawEnvironment();
  return Object.hasOwn(SLUGS, raw) ? SLUGS[raw] : DEFAULT_SLUG;
}

export function environmentLabel(slug = environmentSlug()) {
  return LABELS[slug] || LABELS[DEFAULT_SLUG];
}

/**
 * Short, non-reversible fingerprint of the configured store host.
 *
 * Lets an operator see at a glance whether two environments point at the same
 * database, without ever exposing a URL or token.
 */
export function storeFingerprint() {
  const url =
    process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
  if (!url) return null;
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    // Fall back to hashing the raw value; it is never returned in the clear.
  }
  return createHash("sha256").update(host).digest("hex").slice(0, 8);
}

/**
 * Optional operator declaration of which store the credentials belong to,
 * set alongside them as ANALYTICS_STORE_ENV. When present it is compared with
 * the actual environment.
 */
export function declaredStoreSlug() {
  const raw = String(process.env.ANALYTICS_STORE_ENV || "")
    .trim()
    .toLowerCase();
  if (!raw) return null;
  if (Object.hasOwn(SLUGS, raw)) return SLUGS[raw];
  return Object.values(SLUGS).includes(raw) ? raw : "unknown";
}

/**
 * Configuration warnings for the internal dashboard.
 *
 * These never take the public product down — analytics degrade quietly — but
 * an operator reading a dashboard must know if it is not what they think.
 */
export function configurationWarnings() {
  const slug = environmentSlug();
  const declared = declaredStoreSlug();
  const warnings = [];

  if (declared && declared !== slug) {
    warnings.push(
      `This ${environmentLabel(slug)} deployment is configured with a store declared as "${declared}". Analytics are namespaced by environment, so data stays separated, but the credentials are likely wrong.`,
    );
  }

  if (!rawEnvironment()) {
    warnings.push(
      "VERCEL_ENV is not set, so analytics are recorded under the development namespace.",
    );
  }

  return warnings;
}

/** Everything the dashboard needs to identify what it is looking at. */
export function environmentInfo() {
  const slug = environmentSlug();
  return {
    slug,
    label: environmentLabel(slug),
    store_fingerprint: storeFingerprint(),
    declared_store: declaredStoreSlug(),
    warnings: configurationWarnings(),
  };
}
