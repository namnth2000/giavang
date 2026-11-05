import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker, { updateSnapshot } from "../src/index.js";
import { SOURCES } from "../src/sources.js";

const ids = ["sjc", "xau", "fuel"];
const quotes = {
  sjc: { buy: 135000000, sell: 138000000, quotedAt: "2026-11-04T00:00:00Z" },
  xau: { price: 4100, quotedAt: "2026-11-04T00:00:00Z" },
  fuel: { price: 24000, quotedAt: "2026-11-04T00:00:00Z" },
};
const collectors = Object.fromEntries(ids.map((id) => [id, async () => quotes[id]]));

test("Cloudflare has a single Cron trigger every 15 minutes", () => {
  const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.deepEqual(config.triggers.crons, ["*/15 * * * *"]);
});

test("every quarter-hour in a UTC day collects all three prices once", async () => {
  for (let hour = 0; hour < 24; hour++) {
    for (const minute of [0, 15, 30, 45]) {
      const at = Date.UTC(2026, 10, 5, hour, minute);
      const calls = [];
      const snapshot = await updateSnapshot(null, at, Object.fromEntries(ids.map((id) => [id, async () => {
        calls.push(id);
        return quotes[id];
      }])));
      assert.deepEqual(calls, ids);
      assert.equal(snapshot.generatedAt, new Date(at).toISOString());
      for (const id of ids) {
        assert.equal(snapshot.prices[id].intervalHours, 0.25);
        assert.equal(snapshot.prices[id].checkedAt, snapshot.generatedAt);
        assert.equal(snapshot.prices[id].lastAttemptAt, snapshot.generatedAt);
        assert.equal(snapshot.prices[id].quotedAt, quotes[id].quotedAt);
        assert.equal(snapshot.prices[id].error, null);
      }
    }
  }
});

test("individual and total failures preserve valid quotes and recover on the next run", async (t) => {
  t.mock.method(console, "warn", () => {});
  const previous = await updateSnapshot(null, "2026-11-05T01:00:00Z", collectors);
  const original = structuredClone(previous);
  for (const failed of [["sjc"], ["xau"], ["fuel"], ids]) {
    const at = "2026-11-05T01:15:00.000Z";
    const snapshot = await updateSnapshot(previous, at, Object.fromEntries(ids.map((id) => [id, async () => {
      if (failed.includes(id)) throw new Error("Upstream unavailable");
      return quotes[id];
    }])));
    for (const id of ids) {
      const price = snapshot.prices[id];
      for (const field of ["buy", "sell", "price", "quotedAt"]) {
        assert.equal(price[field], previous.prices[id][field]);
      }
      assert.equal(price.lastAttemptAt, at);
      assert.equal(price.checkedAt, failed.includes(id) ? previous.generatedAt : at);
      assert.equal(Boolean(price.error), failed.includes(id));
    }
    const recovered = await updateSnapshot(snapshot, "2026-11-05T01:30:00Z", collectors);
    for (const id of ids) {
      assert.equal(recovered.prices[id].error, null);
      assert.equal(recovered.prices[id].checkedAt, recovered.generatedAt);
    }
  }
  assert.deepEqual(previous, original);
});

test("scheduled failures still write one shared KV snapshot and the API serves it", async (t) => {
  t.mock.method(console, "warn", () => {});
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    requests.push(url);
    return new Response("Unavailable", { status: 503 });
  });
  let stored = await updateSnapshot(null, "2026-11-05T01:00:00Z", collectors);
  const previous = structuredClone(stored);
  const reads = [];
  const writes = [];
  const env = { PRICES: {
    async get(key, options) {
      reads.push({ key, options });
      return structuredClone(stored);
    },
    async put(key, value) {
      writes.push({ key, value });
      stored = JSON.parse(value);
    },
  } };
  const at = "2026-11-05T01:15:00.000Z";
  await worker.scheduled({ scheduledTime: Date.parse(at), cron: "*/15 * * * *" }, env);
  assert.deepEqual(reads, [{ key: "latest-prices-v1", options: { type: "json" } }]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].key, reads[0].key);
  assert.equal(stored.generatedAt, at);
  assert.deepEqual(Object.keys(stored.prices), ids);
  for (const id of ids) {
    assert.ok(requests.includes(id === "xau" ? SOURCES[id].endpoint : SOURCES[id].url));
    const price = stored.prices[id];
    assert.equal(price.lastAttemptAt, at);
    assert.equal(price.checkedAt, previous.prices[id].checkedAt);
    assert.ok(price.error);
    for (const field of ["buy", "sell", "price", "quotedAt"]) {
      assert.equal(price[field], previous.prices[id][field]);
    }
  }
  const requestCount = requests.length;
  const response = await worker.fetch(new Request("https://example.test/api/prices"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), stored);
  assert.equal(reads.length, 2);
  assert.equal(writes.length, 1);
  assert.equal(requests.length, requestCount);
});
