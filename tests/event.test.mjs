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
