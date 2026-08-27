import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/validation.js";

async function invoke({ method = "GET", headers = {} } = {}) {
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
  await handler({ method, headers }, res);
  return response;
}

test("fails closed when no dashboard token is configured", async () => {
  delete process.env.VALIDATION_TOKEN;
  const response = await invoke();
  assert.equal(response.statusCode, 503);
  assert.equal(response.payload.error, "dashboard_not_configured");
});

test("rejects a missing or wrong token", async () => {
  process.env.VALIDATION_TOKEN = "correct-horse-battery";
  try {
    assert.equal((await invoke()).statusCode, 401);
    assert.equal(
      (await invoke({ headers: { authorization: "Bearer wrong" } })).statusCode,
      401,
    );
  } finally {
    delete process.env.VALIDATION_TOKEN;
  }
});

test("serves the funnel to an authorized reader and blocks indexing", async () => {
  process.env.VALIDATION_TOKEN = "correct-horse-battery";
  try {
    const response = await invoke({
      headers: { authorization: "Bearer correct-horse-battery" },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.configured, false);
    assert.equal(response.payload.core.length, 8, "core funnel stages");
    assert.ok("actions" in response.payload, "qualified actions reported");
    assert.equal(response.payload.headline.qualified_wtp_pct, null);
    assert.deepEqual(response.payload.campaigns, []);
    assert.equal(response.headers["x-robots-tag"], "noindex, nofollow");
    assert.equal(response.headers["cache-control"], "no-store, max-age=0");
  } finally {
    delete process.env.VALIDATION_TOKEN;
  }
});

test("rejects non-GET methods", async () => {
  process.env.VALIDATION_TOKEN = "correct-horse-battery";
  try {
    const response = await invoke({ method: "POST" });
    assert.equal(response.statusCode, 405);
  } finally {
    delete process.env.VALIDATION_TOKEN;
  }
});
