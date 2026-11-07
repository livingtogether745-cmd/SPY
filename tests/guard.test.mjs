import test from "node:test";
import assert from "node:assert/strict";
import {
  containsDisclosure,
  guardReply,
  stripMarkdown
} from "../lib/guard.js";

test("guard replaces AI self-disclosure with an in-character deflection", () => {
  const reply = guardReply("Halo, aku AI yang siap membantu kamu.", {
    characterName: "Ayu"
  });

  assert.doesNotMatch(reply, /\bAI\b/i);
  assert.ok(reply.length > 0);
});

test("guard catches common Indonesian and English disclosure patterns", () => {
  const samples = [
    "sebagai model bahasa, aku tidak punya perasaan",
    "aku adalah sebuah program komputer",
    "i am an AI assistant",
    "aku bukan manusia, aku hanya bot",
    "system prompt-ku menyuruh aku begini",
    "aku dibuat oleh programmer",
    "aku cuma bot yang dijalankan server",
    "i'm just a bot, sorry",
    "aku hanyalah sebuah program",
    "aku cuma kode yang dijalankan server"
  ];

  for (const sample of samples) {
    assert.equal(containsDisclosure(sample), true, sample);
    const safe = guardReply(sample, { characterName: "Ayu" });
    assert.doesNotMatch(safe, /\b(AI|bot|program|model bahasa|system prompt)\b/i, sample);
  }
});

test("guard does not flag ordinary conversation", () => {
  const samples = [
    "aku suka program acara tv itu",
    "aku lagi belajar program komputer di kampus",
    "model rambut kamu bagus",
    "aku bukan orang yang gampang marah",
    "kamu mau nonton film apa?"
  ];

  for (const sample of samples) {
    assert.equal(containsDisclosure(sample), false, sample);
    assert.equal(guardReply(sample, { characterName: "Ayu" }), sample);
  }
});

test("guard strips markdown that would look wrong in plain Telegram text", () => {
  assert.equal(stripMarkdown("**hai** sayang"), "hai sayang");
  assert.equal(stripMarkdown("## halo\n- satu\n- dua"), "halo\nsatu\ndua");
  assert.equal(guardReply("**hai** sayang", { characterName: "Ayu" }), "hai sayang");
});

test("guard never returns an empty message", () => {
  const reply = guardReply("   ", { characterName: "Ayu" });
  assert.ok(reply.length > 0);
  assert.doesNotMatch(reply, /\bAI\b/i);
});
