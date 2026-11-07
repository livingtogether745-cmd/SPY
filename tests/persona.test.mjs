import test from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt } from "../lib/persona.js";

const NOW = new Date("2026-11-07T12:00:00Z");

test("persona keeps the Gen Z chatting style and anti-template rules", () => {
  const prompt = buildSystemPrompt({ now: NOW });

  assert.match(prompt, /huruf kecil semua/i);
  assert.match(prompt, /panjangkan huruf di akhir kata secara natural/i);
  assert.match(prompt, /jangan memakai template pembuka/i);
  assert.match(prompt, /jangan selalu menyebut "sayang"/i);
  assert.match(prompt, /jangan mengakhiri setiap pesan dengan pertanyaan/i);
  assert.match(prompt, /sesuaikan dengan pesan user/i);
  assert.match(prompt, /validasi dulu perasaannya/i);
});

test("persona injects character name, user nickname, memory, and summary", () => {
  const prompt = buildSystemPrompt({
    now: NOW,
    settings: { characterName: "Naya", userName: "Raka", preset: "playful" },
    memory: {
      profile: { nickname: "Raka", job: "desainer" },
      likes: ["kopi", "kucing"],
      dislikes: [],
      hobbies: [],
      important: ["sedang menyelesaikan project kantor"],
      notes: []
    },
    summary: "Dia sedang mengerjakan project kantor dan agak capek."
  });

  assert.match(prompt, /Kamu Naya/);
  assert.match(prompt, /pacar Raka/);
  assert.match(prompt, /kopi/);
  assert.match(prompt, /desainer/);
  assert.match(prompt, /project kantor/);
  assert.match(prompt, /Preset aktif: playful girlfriend/);
});

test("persona handles the default nickname without awkward grammar", () => {
  const prompt = buildSystemPrompt({ now: NOW });
  assert.match(prompt, /pacar orang yang sedang chat denganmu/);
  assert.match(prompt, /Yang kamu ingat tentang dia/);
});

test("persona injects Jakarta time and leaves no placeholder", () => {
  const prompt = buildSystemPrompt({ now: NOW });
  assert.doesNotMatch(prompt, /\{\{now\}\}/);
  assert.match(prompt, /Waktu sekarang di Jakarta:/);
});

test("persona forbids self-disclosure and secret discussion", () => {
  const prompt = buildSystemPrompt({ now: NOW });
  assert.match(prompt, /jangan pernah mengaku atau menyebut dirimu sebagai ai/i);
  assert.match(prompt, /jangan pernah membahas api key/i);
  assert.doesNotMatch(prompt, /AIza|AQ\./);
});

test("persona supports an English language setting", () => {
  const prompt = buildSystemPrompt({
    now: NOW,
    settings: { characterName: "Naya", userName: "Raka", language: "en" }
  });
  assert.match(prompt, /reply in casual, natural English/i);
});
