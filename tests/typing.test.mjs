import test from "node:test";
import assert from "node:assert/strict";
import { calculateTypingDelay, startTyping, waitForTyping } from "../lib/telegram.js";

test("typing delay scales with text length and is capped", () => {
  assert.equal(calculateTypingDelay(0), 350);
  assert.equal(calculateTypingDelay(100), 1550);
  assert.equal(calculateTypingDelay(1000), 2500);
  assert.equal(calculateTypingDelay(50, { baseMs: 0, perCharMs: 10, maxMs: 10000 }), 500);
});

test("waitForTyping subtracts generation time already spent", async () => {
  const delays = [];
  const remaining = await waitForTyping(100, 1000, {
    sleep: async (ms) => {
      delays.push(ms);
    }
  });

  assert.equal(remaining, 550);
  assert.deepEqual(delays, [550]);
});

test("waitForTyping does not wait when generation already exceeded the target", async () => {
  const delays = [];
  const remaining = await waitForTyping(100, 5000, {
    sleep: async (ms) => {
      delays.push(ms);
    }
  });

  assert.equal(remaining, 0);
  assert.deepEqual(delays, []);
});

test("startTyping sends immediately, refreshes, and stops cleanly", async () => {
  let calls = 0;
  const typing = startTyping(123, {
    intervalMs: 10,
    sendAction: async () => {
      calls += 1;
    }
  });

  assert.equal(calls, 1);
  await new Promise((resolve) => setTimeout(resolve, 60));
  typing.stop();
  const callsAtStop = calls;
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.ok(callsAtStop >= 2);
  assert.equal(calls, callsAtStop);
});
