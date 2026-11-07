import test from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt } from "../lib/persona.js";

test("persona avoids robotic openers and dismissive replies", () => {
  const prompt = buildSystemPrompt(new Date("2026-11-07T12:00:00Z"));

  assert.match(prompt, /variasi panjang pesan/i);
  assert.match(prompt, /jangan selalu membalas dengan kalimat pembuka template/i);
  assert.match(prompt, /2-5 kalimat/i);
  assert.match(prompt, /pendapat yang jelas/i);
  assert.match(prompt, /tetap jadi ayu/i);
  assert.match(prompt, /jangan memberi jawaban satu kata/i);
  assert.match(prompt, /jangan berasumsi/i);
});

test("persona injects Jakarta time and leaves no placeholder", () => {
  const prompt = buildSystemPrompt(new Date("2026-11-07T12:00:00Z"));
  assert.doesNotMatch(prompt, /\{\{now\}\}/);
  assert.match(prompt, /Waktu sekarang di Jakarta:/);
});
