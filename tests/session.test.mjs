import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

import { clearMemoryStoreForTests } from "../lib/store.js";
import {
  MAX_HISTORY_MESSAGES,
  appendExchange,
  acquireUserLock,
  buildRecentTranscript,
  checkRateLimit,
  clearLongTermMemory,
  defaultSession,
  loadSession,
  markUpdateProcessed,
  needsSummary,
  normalizeSession,
  resetConversation,
  saveSession,
  summarizeHistory
} from "../lib/session.js";

beforeEach(() => {
  clearMemoryStoreForTests();
});

test("default session has isolated settings, empty memory, and no history", () => {
  const session = defaultSession(1000);
  assert.equal(session.version, 2);
  assert.equal(session.history.length, 0);
  assert.equal(session.summary, "");
  assert.equal(session.counters.userMessages, 0);
  assert.ok(session.settings.characterName.length > 0);
  assert.equal(session.settings.userName, "kamu");
});

test("normalizeSession recovers from malformed stored data", () => {
  const session = normalizeSession({
    settings: { preset: "unknown", clinginess: 9, language: "xx" },
    history: [{ role: "model", text: "hai" }, { role: "user", text: "" }, null],
    memory: { likes: ["kopi", "kopi"] },
    counters: { userMessages: -3 }
  });

  assert.equal(session.settings.preset, "sweet");
  assert.equal(session.settings.clinginess, 1);
  assert.equal(session.settings.language, "id");
  assert.equal(session.history.length, 1);
  assert.deepEqual(session.memory.likes, ["kopi"]);
  assert.equal(session.counters.userMessages, 0);
});

test("saveSession and loadSession round-trip one user document", async () => {
  const session = defaultSession();
  session.settings.characterName = "Naya";
  session.settings.userName = "Raka";
  await saveSession("user-1", session);

  const loaded = await loadSession("user-1");
  assert.equal(loaded.settings.characterName, "Naya");
  assert.equal(loaded.settings.userName, "Raka");
});

test("appendExchange stores both turns and enforces the history cap", () => {
  const session = defaultSession();
  appendExchange(session, "halo", "hai kamu");

  assert.equal(session.history.length, 2);
  assert.equal(session.history[0].role, "user");
  assert.equal(session.history[1].role, "model");

  for (let index = 0; index < 30; index += 1) {
    appendExchange(session, `pesan ${index}`, `balasan ${index}`);
  }
  assert.equal(session.history.length, MAX_HISTORY_MESSAGES);
});

test("resetConversation clears context but keeps memory and settings", () => {
  const session = defaultSession();
  session.settings.characterName = "Naya";
  session.memory.profile.nickname = "Raka";
  appendExchange(session, "halo", "hai");
  session.summary = "ringkasan";

  resetConversation(session);

  assert.equal(session.history.length, 0);
  assert.equal(session.summary, "");
  assert.equal(session.settings.characterName, "Naya");
  assert.equal(session.memory.profile.nickname, "Raka");
});

test("clearLongTermMemory clears memory but keeps the active conversation", () => {
  const session = defaultSession();
  session.memory.profile.nickname = "Raka";
  appendExchange(session, "halo", "hai");

  clearLongTermMemory(session);

  assert.equal(session.memory.profile.nickname, "");
  assert.equal(session.history.length, 2);
});

test("markUpdateProcessed deduplicates the same Telegram update", async () => {
  assert.equal(await markUpdateProcessed(12345), true);
  assert.equal(await markUpdateProcessed(12345), false);
  assert.equal(await markUpdateProcessed(12346), true);
});

test("checkRateLimit allows the limit and blocks the next message", async () => {
  assert.equal((await checkRateLimit("u1", { limit: 2 })).allowed, true);
  assert.equal((await checkRateLimit("u1", { limit: 2 })).allowed, true);

  const blocked = await checkRateLimit("u1", { limit: 2 });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.count, 3);

  assert.equal((await checkRateLimit("u2", { limit: 2 })).allowed, true);
});

test("acquireUserLock serializes turns and releases cleanly", async () => {
  const first = await acquireUserLock("u1", { waitMs: 0 });
  assert.equal(first.acquired, true);

  const second = await acquireUserLock("u1", { waitMs: 0 });
  assert.equal(second.acquired, false);

  await first.release();
  const third = await acquireUserLock("u1", { waitMs: 0 });
  assert.equal(third.acquired, true);
  await third.release();
});

test("summarizeHistory keeps recent turns and stores a summary", async () => {
  const history = Array.from({ length: 10 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "model",
    text: `pesan ${index}`,
    at: index
  }));

  assert.equal(needsSummary(history), false);
  assert.equal(needsSummary(Array.from({ length: 32 }, () => ({ role: "user", text: "x" }))), true);

  const result = await summarizeHistory({
    history,
    previousSummary: "ringkasan lama",
    keep: 2,
    generateImpl: async (prompt) => {
      assert.match(prompt, /ringkasan lama/);
      assert.match(prompt, /pesan 0/);
      return "ringkasan baru";
    }
  });

  assert.equal(result.summary, "ringkasan baru");
  assert.equal(result.keptHistory.length, 2);
  assert.equal(result.keptHistory[0].text, "pesan 8");
});

test("buildRecentTranscript labels user and character turns", () => {
  const transcript = buildRecentTranscript(
    [
      { role: "user", text: "halo" },
      { role: "model", text: "hai" }
    ],
    2
  );
  assert.deepEqual(transcript, ["user: halo", "kamu: hai"]);
});
