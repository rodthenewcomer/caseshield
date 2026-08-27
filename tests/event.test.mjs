import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/event.js";

/**
 * The handler is async (it awaits the durable store), so every assertion must
 * await it — otherwise a passing status is just the mock's default value.
 */
async function invoke({ method = "POST", headers = {}, body = {} } = {}) {
  const response = { statusCode: null, headers: {}, payload: null };
  const res = {
    setHeader(name, value) {
      response.headers[name.toLowerCase()] = value;
    },
    status(code) {
      response.statusCode = code;
      return this;
    },
    json(payload) {
      response.payload = payload;
      return response;
    },
  };
  const req = {
    method,
    headers: {
      host: "caseshield-validation.vercel.app",
      "content-type": "application/json",
      ...headers,
    },
    body,
  };
  await handler(req, res);
  return response;
}

async function withSilentLog(run) {
  const messages = [];
  const originalLog = console.log;
  console.log = (...args) => messages.push(args.join(" "));
  try {
    return { result: await run(), messages };
  } finally {
    console.log = originalLog;
  }
}

test("accepts an allowlisted same-origin validation event", async () => {
  const { result } = await withSilentLog(() =>
    invoke({
      headers: { origin: "https://caseshield-validation.vercel.app" },
      body: {
        name: "case_step_3",
        session_id: "88e31ee8-e627-4180-bfc5-94f39f5de700",
        step_id: "embassy",
        answer: "London",
      },
    }),
  );
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(result.headers["cache-control"], "no-store, max-age=0");
});

test("reports storage state without failing the visitor request", async () => {
  // No store credentials in test env: the request must still succeed.
  const { result } = await withSilentLog(() =>
    invoke({ body: { name: "page_view", session_id: "valid-session-id" } }),
  );
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.stored, false);
});

test("rejects cross-origin event submissions", async () => {
  const response = await invoke({
    headers: { origin: "https://attacker.example" },
    body: { name: "page_view", session_id: "valid-session-id" },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.payload.error, "origin_not_allowed");
});

test("requires JSON and an allowlisted event name", async () => {
  const wrongType = await invoke({
    headers: { "content-type": "text/plain" },
    body: "page_view",
  });
  assert.equal(wrongType.statusCode, 415);

  const unknownEvent = await invoke({
    body: { name: "unknown", session_id: "valid-session-id" },
  });
  assert.equal(unknownEvent.statusCode, 400);
});

test("rejects oversized payloads", async () => {
  const response = await invoke({
    body: { name: "page_view", padding: "x".repeat(5_000) },
  });
  assert.equal(response.statusCode, 413);
});

test("rejects non-POST methods", async () => {
  const response = await invoke({ method: "GET" });
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.allow, "POST");
});

test("redacts a probable case number from embassy metadata", async () => {
  const { result, messages } = await withSilentLog(() =>
    invoke({
      body: {
        name: "case_step_3",
        session_id: "88e31ee8-e627-4180-bfc5-94f39f5de700",
        step_id: "embassy",
        answer: "ABJ2026123456",
      },
    }),
  );
  assert.equal(result.statusCode, 200);
  assert.match(messages[0], /\[redacted\]/);
  assert.doesNotMatch(messages[0], /ABJ2026123456/);
});

test("rejects a cross-site caller that omits Origin", async () => {
  const response = await invoke({
    headers: { "sec-fetch-site": "cross-site" },
    body: { name: "page_view", session_id: "valid-session-id" },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.payload.error, "origin_not_allowed");
});

test("accepts and sanitizes campaign attribution", async () => {
  const { result, messages } = await withSilentLog(() =>
    invoke({
      body: {
        name: "page_view",
        session_id: "valid-session-id",
        utm_source: "google",
        utm_medium: "cpc",
        utm_campaign: "interview_disruption",
        utm_content: "cancelled",
        utm_term: "immigrant visa interview cancelled",
        referrer_host: "www.google.com",
      },
    }),
  );
  assert.equal(result.statusCode, 200);
  const event = JSON.parse(messages[0].replace("CASESHIELD_EVENT ", ""));
  assert.equal(event.utm_source, "google");
  assert.equal(event.utm_campaign, "interview_disruption");
  assert.equal(event.referrer_host, "google.com", "www stripped");
});

test("drops attribution fields that are not on the allowlist", async () => {
  const { messages } = await withSilentLog(() =>
    invoke({
      body: {
        name: "page_view",
        session_id: "valid-session-id",
        utm_source: "google",
        gclid: "Cj0KCQjw_ABCDEF",
        referrer: "https://www.google.com/search?q=private+terms",
        email: "someone@example.com",
        ip: "203.0.113.9",
        user_id: "u-123",
      },
    }),
  );
  const event = JSON.parse(messages[0].replace("CASESHIELD_EVENT ", ""));
  assert.equal(event.utm_source, "google");
  for (const forbidden of ["gclid", "referrer", "email", "ip", "user_id"]) {
    assert.ok(!(forbidden in event), `${forbidden} must be dropped`);
  }
  assert.ok(!messages[0].includes("private+terms"));
  assert.ok(!messages[0].includes("someone@example.com"));
});

test("redacts a probable case number smuggled through a campaign URL", async () => {
  // A crafted ad URL is a real vector, not only the embassy input.
  const { messages } = await withSilentLog(() =>
    invoke({
      body: {
        name: "page_view",
        session_id: "valid-session-id",
        utm_term: "case ABJ2026123456 status",
      },
    }),
  );
  assert.match(messages[0], /\[redacted\]/);
  assert.doesNotMatch(messages[0], /ABJ2026123456/);
});

test("caps attribution field length", async () => {
  const { messages } = await withSilentLog(() =>
    invoke({
      body: {
        name: "page_view",
        session_id: "valid-session-id",
        utm_campaign: "x".repeat(300),
      },
    }),
  );
  const event = JSON.parse(messages[0].replace("CASESHIELD_EVENT ", ""));
  assert.ok(event.utm_campaign.length <= 60, "attribution length is capped");
});
