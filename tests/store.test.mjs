import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

import {
  clearMemoryStoreForTests,
  del,
  getJson,
  incrWithTtl,
  isPersistent,
  setIfAbsent,
  setJson
} from "../lib/store.js";

beforeEach(() => {
  clearMemoryStoreForTests();
});

test("in-memory fallback is used when Redis is not configured", () => {
  assert.equal(isPersistent(), false);
});

test("setJson and getJson round-trip structured values", async () => {
  await setJson("key", { hello: "world", count: 2 });
  assert.deepEqual(await getJson("key"), { hello: "world", count: 2 });

  await del("key");
  assert.equal(await getJson("key"), null);
});

test("setIfAbsent only lets the first caller win", async () => {
  assert.equal(await setIfAbsent("lock", "1", 60), true);
  assert.equal(await setIfAbsent("lock", "1", 60), false);
  await del("lock");
  assert.equal(await setIfAbsent("lock", "1", 60), true);
});

test("incrWithTtl counts within the window and is isolated per key", async () => {
  assert.equal(await incrWithTtl("counter:a", 60), 1);
  assert.equal(await incrWithTtl("counter:a", 60), 2);
  assert.equal(await incrWithTtl("counter:b", 60), 1);
});

test("expired in-memory values are treated as missing", async () => {
  await setJson("short", "value", 0.01);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(await getJson("short"), null);
});
