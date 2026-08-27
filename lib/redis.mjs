/**
 * Minimal Upstash Redis REST client.
 *
 * Dependency-free on purpose: the REST pipeline is a single fetch, which keeps
 * the runtime free of packages and portable across serverless runtimes.
 */

const WRITE_TIMEOUT_MS = 2_000;
const READ_TIMEOUT_MS = 5_000;

function credentials() {
  const url =
    process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
  const token =
    process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

export function isConfigured() {
  return credentials() !== null;
}

/**
 * Run commands as one pipeline. Returns an array of raw results, or null when
 * no credentials are configured.
 */
export async function pipeline(commands, { read = false } = {}) {
  const creds = credentials();
  if (!creds || commands.length === 0) return null;

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    read ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS,
  );
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
    const payload = await response.json();
    return payload.map((entry) => entry?.result);
  } finally {
    clearTimeout(timer);
  }
}

export function toCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
