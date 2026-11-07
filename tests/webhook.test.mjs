import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { clearMemoryStoreForTests } from "../lib/store.js";
import handler from "../api/webhook.js";

const originalFetch = globalThis.fetch;

process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.TELEGRAM_PUBLIC = "true";
process.env.GEMINI_API_KEY = "test-key";
process.env.GEMINI_MODEL = "gemini-test";
delete process.env.TELEGRAM_ALLOWED_IDS;
delete process.env.TELEGRAM_OWNER_ID;
delete process.env.BOT_PERSONA;
delete process.env.CHARACTER_NAME;
delete process.env.DEFAULT_PRESET;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

let sent = [];
let edited = [];
let updateId = 1000;
let forceDisclosure = false;

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    }
  };
}

function messageUpdate(text, fromId = 123) {
  updateId += 1;
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: fromId, type: "private" },
      from: { id: fromId, is_bot: false, first_name: "Test" },
      text
    }
  };
}

function callbackUpdate(data, fromId = 123) {
  updateId += 1;
  return {
    update_id: updateId,
    callback_query: {
      id: `cb-${updateId}`,
      from: { id: fromId, is_bot: false, first_name: "Test" },
      message: {
        message_id: 10,
        chat: { id: fromId, type: "private" }
      },
      data
    }
  };
}

function makeRes() {
  return {
    statusCode: 0,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

async function invoke(update) {
  const req = {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": "test-secret" },
    body: update
  };
  const res = makeRes();
  await handler(req, res);
  return res;
}

beforeEach(() => {
  clearMemoryStoreForTests();
  sent = [];
  edited = [];
  forceDisclosure = false;
  process.env.TELEGRAM_PUBLIC = "true";
  delete process.env.TELEGRAM_ALLOWED_IDS;
  delete process.env.TELEGRAM_OWNER_ID;

  globalThis.fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : {};

    if (url.includes("generativelanguage.googleapis.com")) {
      if (body.generationConfig?.responseMimeType === "application/json") {
        return jsonResponse({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: '{"profile":{"nickname":"Raka"},"likes":["kopi"],"dislikes":[],"hobbies":[],"important":[],"notes":[]}'
                  }
                ]
              }
            }
          ]
        });
      }

      if (forceDisclosure) {
        return jsonResponse({
          candidates: [
            { content: { parts: [{ text: "Aku adalah AI yang siap membantu kamu." }] } }
          ]
        });
      }

      const last = body.contents?.at(-1)?.parts?.[0]?.text ?? "";
      let text = "haii kamuuu 🥰";
      if (last.includes("pesan A")) text = "balasan A 🥰";
      if (last.includes("pesan B")) text = "balasan B 🥰";
      return jsonResponse({ candidates: [{ content: { parts: [{ text }] } }] });
    }

    if (url.includes("api.telegram.org")) {
      if (url.endsWith("/sendMessage")) sent.push(body);
      if (url.endsWith("/editMessageText")) edited.push(body);
      return jsonResponse({ ok: true, result: { message_id: 1 } });
    }

    throw new Error(`URL tidak dikenal: ${url}`);
  };
});

after(() => {
  globalThis.fetch = originalFetch;
});

test("webhook rejects a wrong secret", async () => {
  const req = {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": "wrong" },
    body: messageUpdate("halo")
  };
  const res = makeRes();
  await handler(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(sent.length, 0);
});

test("/start returns the greeting and inline preset keyboard", async () => {
  const res = await invoke(messageUpdate("/start"));
  assert.equal(res.statusCode, 200);

  const reply = sent.at(-1);
  assert.match(reply.text, /akhirnya kamu datang/);
  assert.ok(reply.reply_markup.inline_keyboard.length >= 1);
});

test("a normal message gets an in-character reply and stores memory", async () => {
  await invoke(messageUpdate("namaku Raka, aku suka kopi"));

  const reply = sent.at(-1);
  assert.match(reply.text, /haii kamuuu/);

  await invoke(messageUpdate("/memory"));
  const memoryReply = sent.at(-1);
  assert.match(memoryReply.text, /Raka/);
  assert.match(memoryReply.text, /kopi/);
});

test("/clearmemory confirms through an inline callback and clears only memory", async () => {
  await invoke(messageUpdate("namaku Raka, aku suka kopi"));
  await invoke(messageUpdate("/clearmemory"));

  assert.match(sent.at(-1).text, /yakin mau hapus/);

  await invoke(callbackUpdate("clear:yes"));
  assert.match(edited.at(-1).text, /udah aku hapus/);

  await invoke(messageUpdate("/memory"));
  assert.match(sent.at(-1).text, /belum cerita banyak/);
});

test("guard replaces a model self-disclosure before sending", async () => {
  forceDisclosure = true;
  await invoke(messageUpdate("kamu itu ai ya?"));

  const reply = sent.at(-1);
  assert.doesNotMatch(reply.text, /\bAI\b/i);
  assert.ok(reply.text.length > 0);
});

test("two rapid messages are serialized and both get their own reply", async () => {
  await Promise.all([
    invoke(messageUpdate("pesan A")),
    invoke(messageUpdate("pesan B"))
  ]);

  const replies = sent.map((item) => item.text);
  assert.ok(replies.some((text) => text.includes("balasan A")));
  assert.ok(replies.some((text) => text.includes("balasan B")));
});

test("/persona and preset callbacks update the character settings", async () => {
  await invoke(messageUpdate("/persona"));
  assert.match(sent.at(-1).text, /pengaturan aku sekarang/);

  await invoke(callbackUpdate("p:preset:playful"));
  assert.match(edited.at(-1).text, /playful/);
});

test("owner-only mode silently ignores other users", async () => {
  process.env.TELEGRAM_PUBLIC = "false";
  process.env.TELEGRAM_OWNER_ID = "999";

  await invoke(messageUpdate("halo", 123));
  assert.equal(sent.length, 0);
});
