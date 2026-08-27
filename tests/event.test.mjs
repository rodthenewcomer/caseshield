import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/event.js";

function invoke({ method = "POST", headers = {}, body = {} } = {}) {
  const response = { statusCode: 200, headers: {}, payload: null };
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
  handler(req, res);
  return response;
}

test("accepts an allowlisted same-origin validation event", () => {
  const originalLog = console.log;
  console.log = () => {};
  try {
    const response = invoke({
      headers: { origin: "https://caseshield-validation.vercel.app" },
      body: {
        name: "case_step_3",
        session_id: "88e31ee8-e627-4180-bfc5-94f39f5de700",
        step_id: "embassy",
        answer: "London",
      },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.payload, { ok: true });
    assert.equal(response.headers["cache-control"], "no-store, max-age=0");
  } finally {
    console.log = originalLog;
  }
});

test("rejects cross-origin event submissions", () => {
  const response = invoke({
    headers: { origin: "https://attacker.example" },
    body: { name: "page_view", session_id: "valid-session-id" },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.payload.error, "origin_not_allowed");
});

test("requires JSON and an allowlisted event name", () => {
  assert.equal(
    invoke({ headers: { "content-type": "text/plain" }, body: "page_view" })
      .statusCode,
    415,
  );
  assert.equal(
    invoke({ body: { name: "unknown", session_id: "valid-session-id" } })
      .statusCode,
    400,
  );
});

test("rejects oversized payloads", () => {
  const response = invoke({
    body: { name: "page_view", padding: "x".repeat(5_000) },
  });
  assert.equal(response.statusCode, 413);
});

test("redacts a probable case number from embassy metadata", () => {
  const messages = [];
  const originalLog = console.log;
  console.log = (...args) => messages.push(args.join(" "));
  try {
    const response = invoke({
      body: {
        name: "case_step_3",
        session_id: "88e31ee8-e627-4180-bfc5-94f39f5de700",
        step_id: "embassy",
        answer: "ABJ2026123456",
      },
    });
    assert.equal(response.statusCode, 200);
    assert.match(messages[0], /\[redacted\]/);
    assert.doesNotMatch(messages[0], /ABJ2026123456/);
  } finally {
    console.log = originalLog;
  }
});
