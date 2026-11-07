import test from "node:test";
import assert from "node:assert/strict";
import {
  createEmptyMemory,
  extractMemoryPatch,
  formatMemoryForPrompt,
  hasMemory,
  mergeMemory,
  normalizeMemory,
  parseJsonObject,
  shouldExtractMemory
} from "../lib/memory.js";

test("normalizeMemory caps lists, trims text, and removes duplicates", () => {
  const memory = normalizeMemory({
    profile: { nickname: "  Raka  ", age: "21", location: "", job: "desainer" },
    likes: ["kopi", "kopi", "kucing", "", 123],
    dislikes: ["hujan"],
    hobbies: Array.from({ length: 20 }, (_, index) => `hobi ${index}`)
  });

  assert.equal(memory.profile.nickname, "Raka");
  assert.deepEqual(memory.likes, ["kopi", "kucing"]);
  assert.equal(memory.hobbies.length, 12);
});

test("mergeMemory keeps old facts and adds new ones without duplicates", () => {
  const base = {
    profile: { nickname: "Raka", job: "desainer" },
    likes: ["kopi"],
    important: ["project kantor"]
  };
  const patch = {
    profile: { nickname: "", location: "Bandung" },
    likes: ["kopi", "kucing"],
    important: ["project kantor", "ultah bulan depan"]
  };

  const merged = mergeMemory(base, patch);
  assert.equal(merged.profile.nickname, "Raka");
  assert.equal(merged.profile.job, "desainer");
  assert.equal(merged.profile.location, "Bandung");
  assert.deepEqual(merged.likes, ["kopi", "kucing"]);
  assert.deepEqual(merged.important, ["project kantor", "ultah bulan depan"]);
});

test("empty memory is explicit so the model never invents facts", () => {
  assert.equal(hasMemory(createEmptyMemory()), false);
  assert.match(formatMemoryForPrompt(createEmptyMemory()), /jangan mengarang/i);
  assert.equal(hasMemory({ profile: { nickname: "Raka" } }), true);
});

test("parseJsonObject accepts fenced model output", () => {
  assert.deepEqual(parseJsonObject('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonObject('ini hasilnya: {"a":2} semoga membantu'), { a: 2 });
  assert.throws(() => parseJsonObject("tidak ada json"), /JSON tidak ditemukan/);
});

test("extractMemoryPatch normalizes a JSON response from the injected generator", async () => {
  let receivedPrompt = "";
  const patch = await extractMemoryPatch({
    memory: createEmptyMemory(),
    recentMessages: ["user: namaku Raka", "kamu: halo Raka"],
    userText: "aku suka kopi dan kucing",
    generateJsonImpl: async (prompt) => {
      receivedPrompt = prompt;
      return {
        profile: { nickname: "Raka" },
        likes: ["kopi", "kucing"]
      };
    }
  });

  assert.match(receivedPrompt, /HANYA JSON valid/);
  assert.match(receivedPrompt, /namaku Raka/);
  assert.equal(patch.profile.nickname, "Raka");
  assert.deepEqual(patch.likes, ["kopi", "kucing"]);
});

test("memory extraction is selective, not every message", () => {
  assert.equal(shouldExtractMemory({ text: "halo", userMessageCount: 0 }), false);
  assert.equal(shouldExtractMemory({ text: "halo", userMessageCount: 3 }), true);
  assert.equal(shouldExtractMemory({ text: "namaku Raka", userMessageCount: 1 }), true);
  assert.equal(shouldExtractMemory({ text: "aku suka kopi", userMessageCount: 1 }), true);
});
