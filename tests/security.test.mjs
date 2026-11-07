import test from "node:test";
import assert from "node:assert/strict";
import {
  isSetupMode,
  isUserAllowed,
  parseIdList,
  resolveAccessFromEnv,
  sanitizeDisplayName,
  secretsMatch,
  truncate
} from "../lib/security.js";
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

test("default Gemini model is the fast production model", () => {
  assert.equal(DEFAULT_GEMINI_MODEL, "gemini-3.5-flash");
});

test("parseIdList accepts commas, spaces, and rejects junk", () => {
  assert.deepEqual(parseIdList("1, 2 3"), ["1", "2", "3"]);
  assert.deepEqual(parseIdList("abc, -100"), ["-100"]);
  assert.deepEqual(parseIdList(undefined), []);
});

test("sanitizeDisplayName strips control characters and caps length", () => {
  assert.equal(sanitizeDisplayName("  Naya\u0000  "), "Naya");
  assert.equal(sanitizeDisplayName("abcdefghij", 4), "abcd");
  assert.equal(sanitizeDisplayName(null), "");
});

test("access policy supports allowlists, public mode, owner fallback, and setup mode", () => {
  const original = {
    allowed: process.env.TELEGRAM_ALLOWED_IDS,
    owner: process.env.TELEGRAM_OWNER_ID,
    public: process.env.TELEGRAM_PUBLIC
  };

  try {
    delete process.env.TELEGRAM_ALLOWED_IDS;
    delete process.env.TELEGRAM_OWNER_ID;
    delete process.env.TELEGRAM_PUBLIC;
    assert.equal(isSetupMode(resolveAccessFromEnv()), true);

    process.env.TELEGRAM_OWNER_ID = "100";
    let access = resolveAccessFromEnv();
    assert.equal(isSetupMode(access), false);
    assert.equal(isUserAllowed("100", access), true);
    assert.equal(isUserAllowed("200", access), false);

    process.env.TELEGRAM_ALLOWED_IDS = "100,200";
    process.env.TELEGRAM_PUBLIC = "true";
    access = resolveAccessFromEnv();
    assert.equal(isUserAllowed("200", access), true);
    assert.equal(isUserAllowed("999", access), false);

    delete process.env.TELEGRAM_ALLOWED_IDS;
    access = resolveAccessFromEnv();
    assert.equal(isUserAllowed("999", access), true);
  } finally {
    for (const [key, value] of Object.entries({
      TELEGRAM_ALLOWED_IDS: original.allowed,
      TELEGRAM_OWNER_ID: original.owner,
      TELEGRAM_PUBLIC: original.public
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
