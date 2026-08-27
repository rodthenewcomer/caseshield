import test from "node:test";
import assert from "node:assert/strict";

/**
 * Exercises the CONFIGURED write path against a stubbed Upstash endpoint.
 *
 * The other store tests only cover the unconfigured no-op path, so a runtime
 * error inside recordEvent stayed invisible: the endpoint still answered 200
 * and simply reported stored:false. These tests close that gap by asserting
 * the commands actually produced.
 */

const ENDPOINT = "https://stub.upstash.io";

function stubRedis({ sismember = 0, scard = 0 } = {}) {
  const batches = [];
  globalThis.fetch = async (_url, options) => {
    const commands = JSON.parse(options.body);
    batches.push(commands);
    return {
      ok: true,
      json: async () =>
        commands.map((command) => {
          const verb = String(command[0]).toUpperCase();
          if (verb === "SISMEMBER") return { result: sismember };
          if (verb === "SCARD") return { result: scard };
          return { result: 1 };
        }),
    };
  };
  return batches;
}

async function freshStore() {
  process.env.KV_REST_API_URL = ENDPOINT;
  process.env.KV_REST_API_TOKEN = "stub-token";
  return import(`../lib/store.mjs?v=${Math.random()}`);
}

function cleanup() {
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete globalThis.fetch;
}

const EVENT = {
  name: "case_check_completed",
  ts: "2026-08-27T12:00:00.000Z",
  session_id: "sess-0001",
  utm_source: "google",
  utm_medium: "cpc",
  utm_campaign: "interview_disruption",
  visa: "CR1 / IR1 spouse",
  embassy: "Abidjan",
};

test("records a campaign-attributed completion without throwing", async () => {
  const batches = stubRedis();
  try {
    const { recordEvent, isConfigured } = await freshStore();
    assert.equal(isConfigured(), true);

    const result = await recordEvent(EVENT);
    assert.deepEqual(result, { stored: true }, "no runtime error in the write path");

    const commands = batches.flat().map((command) => command.join(" "));
    assert.ok(
      commands.some((c) => c.startsWith("SADD cs:v1:uniq:case_check_completed")),
      "unique-session set is written",
    );
    assert.ok(
      commands.some((c) => c.includes("cs:v1:camp:google|cpc|")),
      "cohort membership is written",
    );
    assert.ok(
      commands.some((c) => c.startsWith("SADD cs:v1:ans:visa:cr1-ir1-spouse")),
      "answer segment is written as a session set",
    );
  } finally {
    cleanup();
  }
});

test("resolves every registry membership in one round trip", async () => {
  const batches = stubRedis();
  try {
    const { recordEvent } = await freshStore();
    await recordEvent(EVENT);
    // One lookup batch plus one write batch — never one request per field.
    assert.equal(batches.length, 2, "two requests regardless of field count");
  } finally {
    cleanup();
  }
});

test("buckets a new cohort into overflow once the registry is full", async () => {
  const batches = stubRedis({ sismember: 0, scard: 100_000 });
  try {
    const { recordEvent } = await freshStore();
    await recordEvent(EVENT);
    const commands = batches.flat().map((command) => command.join(" "));
    assert.ok(
      commands.some((c) => c === "SADD cs:v1:campaigns other"),
      "unknown cohort past the cap becomes 'other'",
    );
  } finally {
    cleanup();
  }
});

test("an event with no campaign or answers still records", async () => {
  const batches = stubRedis();
  try {
    const { recordEvent } = await freshStore();
    const result = await recordEvent({
      name: "pricing_view",
      ts: "2026-08-27T12:00:00.000Z",
      session_id: "sess-0002",
    });
    assert.deepEqual(result, { stored: true });
    assert.equal(batches.length, 1, "no lookup batch when nothing to resolve");
  } finally {
    cleanup();
  }
});

test("a store outage never surfaces as a thrown error", async () => {
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    const { recordEvent } = await freshStore();
    const result = await recordEvent(EVENT);
    assert.equal(result.stored, false);
    assert.equal(result.reason, "store_unavailable");
  } finally {
    console.error = originalError;
    cleanup();
  }
});
