import test from "node:test";
import assert from "node:assert/strict";
import { secretsMatch, truncate } from "../lib/security.js";
import { buildSystemPrompt } from "../lib/persona.js";
import { DEFAULT_GEMINI_MODEL } from "../lib/gemini.js";

test("secretsMatch accepts identical secrets and rejects different ones", () => {
  assert.equal(secretsMatch("abc123", "abc123"), true);
  assert.equal(secretsMatch("abc123", "abc124"), false);
  assert.equal(secretsMatch("abc123", "abc1234"), false);
  assert.equal(secretsMatch(undefined, "abc123"), false);
});

test("truncate removes null bytes and enforces a hard limit", () => {
  assert.equal(truncate("  hello\u0000  ", 20), "hello");
  assert.equal(truncate("abcdef", 3), "abc");
  assert.equal(truncate(null, 10), "");
});

test("default persona is Indonesian and does not leak secrets", () => {
  const prompt = buildSystemPrompt(new Date("2026-11-07T12:00:00Z"));
  assert.match(prompt, /Bahasa Indonesia/i);
  assert.match(prompt, /Jangan pernah membahas API key/i);
  assert.doesNotMatch(prompt, /AIza|AQ\./);
});

test("default Gemini model is Gemini 3.1 Flash", () => {
  assert.equal(DEFAULT_GEMINI_MODEL, "gemini-3.1-flash");
});
