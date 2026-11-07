import { generateReply, generateJson } from "../lib/gemini.js";
import {
  sendMessage,
  editMessageText,
  answerCallbackQuery,
  startTyping,
  waitForTyping
} from "../lib/telegram.js";
import { buildSystemPrompt } from "../lib/persona.js";
import { guardReply } from "../lib/guard.js";
import {
  optionalEnv,
  readJsonBody,
  secretsMatch,
  truncate,
  resolveAccessFromEnv,
  isSetupMode,
  isUserAllowed
} from "../lib/security.js";
import {
  defaultSession,
  loadSession,
  saveSession,
  appendExchange,
  markUpdateProcessed,
  checkRateLimit,
  acquireUserLock,
  needsSummary,
  summarizeHistory,
  buildRecentTranscript
} from "../lib/session.js";
import {
  extractMemoryPatch,
  mergeMemory,
  shouldExtractMemory
} from "../lib/memory.js";
import {
  parseCommand,
  handleCommand,
  handleCallback,
  handlePendingClear
} from "../lib/commands.js";

const MAX_INPUT_CHARS = 4000;

const GENERIC_ERROR =
  "aduhh maaf yaa, aku lagi agak lemot nih 🥺 coba chat aku lagi sebentar lagii yaa 💕";
const LOCK_BUSY =
  "sabar dikit yaa sayangg 🥺 aku masih baca pesan kamu yang tadi...";
const RATE_LIMIT =
  "pelan-pelan yaa sayangg 🥺 aku masih di sini kok, chat kamu aku baca satu-satu 💕";
const MEDIA_REPLY =
  "aku belum bisa buka foto atau voice note kamu 🥺 coba ketik aja yaa, aku pengen denger cerita kamu 💕";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const expectedSecret = optionalEnv("TELEGRAM_WEBHOOK_SECRET");
  if (!expectedSecret) {
    console.error("[webhook] TELEGRAM_WEBHOOK_SECRET belum dikonfigurasi");
    res.status(500).json({ ok: false, error: "webhook_secret_not_configured" });
    return;
  }

  const receivedSecret = req.headers["x-telegram-bot-api-secret-token"];
  if (!secretsMatch(receivedSecret, expectedSecret)) {
    res.status(401).json({ ok: false, error: "invalid_webhook_secret" });
    return;
  }

  let update;
  try {
    update = await readJsonBody(req);
  } catch {
    res.status(400).json({ ok: false, error: "invalid_json" });
    return;
  }

  try {
    const fresh = await markUpdateProcessed(update?.update_id);
    if (!fresh) {
      res.status(200).json({ ok: true });
      return;
    }
  } catch (error) {
    // A storage hiccup must not drop a real message.
    console.error("[store] dedupe gagal:", error?.message ?? "error tidak dikenal");
  }

  try {
    await handleUpdate(update);
  } catch (error) {
    // Never log message contents or environment values.
    console.error("[webhook]", error?.message ?? "error tidak dikenal");
  }

  // Always acknowledge valid webhook calls so Telegram does not retry in a loop.
  res.status(200).json({ ok: true });
}

async function handleUpdate(update) {
  if (update?.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return;
  }

  const message = update?.message;
  if (!message || !message.from || message.from.is_bot) return;
  if (message.chat?.type !== "private") return;

  const access = resolveAccessFromEnv();
  if (isSetupMode(access)) {
    await handleSetupMessage(message);
    return;
  }
  if (!isUserAllowed(message.from.id, access)) return;

  await handlePrivateMessage(message);
}

async function handleSetupMessage(message) {
  const chatId = message.chat.id;
  const text = truncate(message.text ?? "", MAX_INPUT_CHARS);
  const command = parseCommand(text);

  if (command?.name === "id") {
    await sendMessage(chatId, `telegram id kamu: ${message.from.id}`);
    return;
  }

  if (command?.name === "start") {
    await sendMessage(
      chatId,
      "sistem aktif. kirim /id buat lihat telegram id kamu, lalu isi TELEGRAM_ALLOWED_IDS atau TELEGRAM_OWNER_ID di vercel."
    );
    return;
  }

  await sendMessage(
    chatId,
    "akses belum dibuka. kirim /id dulu, lalu isi TELEGRAM_ALLOWED_IDS atau TELEGRAM_OWNER_ID di vercel."
  );
}

async function safeSave(userId, session) {
  try {
    await saveSession(userId, session);
  } catch (error) {
    console.error("[store] save gagal:", error?.message ?? "error tidak dikenal");
  }
}

async function loadSessionSafe(userId) {
  try {
    return await loadSession(userId);
  } catch (error) {
    console.error("[store] load gagal:", error?.message ?? "error tidak dikenal");
    return defaultSession();
  }
}

async function handlePrivateMessage(message) {
  const userId = String(message.from.id);
  const chatId = message.chat.id;
  const text = truncate(message.text ?? "", MAX_INPUT_CHARS);
  const command = parseCommand(text);

  // Show the native typing indicator while waiting for a previous turn to
  // finish, so rapid messages still feel responsive.
  let typing = null;
  let startedAt = 0;
  if (!command && text) {
    typing = startTyping(chatId);
    startedAt = Date.now();
  }

  let lock;
  try {
    lock = await acquireUserLock(userId, { waitMs: 10_000 });
  } catch (error) {
    console.error("[store] lock gagal:", error?.message ?? "error tidak dikenal");
    lock = { acquired: true, release: async () => {} };
  }

  if (!lock.acquired) {
    typing?.stop();
    await sendMessage(chatId, LOCK_BUSY);
    return;
  }

  try {
    const session = await loadSessionSafe(userId);

    if (command) {
      const result = handleCommand({
        command: command.name,
        args: command.args,
        session,
        userId
      });
      if (result.changed) await safeSave(userId, session);
      await sendMessage(chatId, result.text, { replyMarkup: result.replyMarkup });
      return;
    }

    if (!text) {
      typing?.stop();
      await sendMessage(chatId, MEDIA_REPLY);
      return;
    }

    const pending = handlePendingClear(session, text);
    if (pending?.text) {
      typing?.stop();
      await safeSave(userId, session);
      await sendMessage(chatId, pending.text);
      return;
    }
    if (pending?.changed) await safeSave(userId, session);

    let rate = { allowed: true, count: 0, limit: 20 };
    try {
      rate = await checkRateLimit(userId);
    } catch (error) {
      console.error("[store] rate limit gagal:", error?.message ?? "error tidak dikenal");
    }
    if (!rate.allowed) {
      typing?.stop();
      if (rate.count === rate.limit + 1) await sendMessage(chatId, RATE_LIMIT);
      return;
    }

    await respondWithChat({ session, userId, chatId, text, typing, startedAt });
  } finally {
    typing?.stop();
    await lock.release();
  }
}

async function respondWithChat({ session, userId, chatId, text, typing: existingTyping, startedAt: existingStartedAt }) {
  const settings = session.settings;
  const startedAt = existingStartedAt || Date.now();
  const typing = existingTyping || startTyping(chatId);

  let safeReply;
  try {
    const rawReply = await generateReply(text, {
      systemPrompt: buildSystemPrompt({
        settings,
        memory: session.memory,
        summary: session.summary
      }),
      history: session.history,
      maxOutputTokens: 512
    });

    safeReply = guardReply(rawReply, { characterName: settings.characterName });

    // Deliver before any bookkeeping. Memory extraction and summarization used
    // to block this send for up to 8s after generation had already finished.
    await waitForTyping(safeReply.length, Date.now() - startedAt);
    typing.stop();
    await sendMessage(chatId, safeReply);
  } catch (error) {
    typing.stop();
    console.error("[gemini]", error?.message ?? "error tidak dikenal");
    await sendMessage(chatId, GENERIC_ERROR);
    return;
  }

  // Post-delivery work. It starts only after the reply is sent so it cannot
  // compete with the generation request or delay the user-visible response.
  try {
    const memoryPromise = shouldExtractMemory({
      text,
      userMessageCount: session.counters.userMessages
    })
      ? extractMemoryPatch({
          memory: session.memory,
          recentMessages: buildRecentTranscript(session.history, 6),
          userText: text,
          generateJsonImpl: generateJson
        }).catch((error) => {
          console.error("[memory]", error?.message ?? "error tidak dikenal");
          return null;
        })
      : Promise.resolve(null);

    const summaryPromise = needsSummary(session.history)
      ? summarizeHistory({
          history: session.history,
          previousSummary: session.summary,
          generateImpl: generateReply
        }).catch((error) => {
          console.error("[summary]", error?.message ?? "error tidak dikenal");
          return null;
        })
      : Promise.resolve(null);

    const [memoryPatch, summaryResult] = await Promise.all([memoryPromise, summaryPromise]);

    if (memoryPatch) session.memory = mergeMemory(session.memory, memoryPatch);
    if (summaryResult) {
      session.summary = summaryResult.summary;
      session.history = summaryResult.keptHistory;
    }

    appendExchange(session, text, safeReply);
    session.counters.userMessages += 1;
    await safeSave(userId, session);
  } catch (error) {
    // The user already has the reply; never send a second error message here.
    console.error("[post-reply]", error?.message ?? "error tidak dikenal");
  }
}

async function handleCallbackQuery(callbackQuery) {
  const from = callbackQuery?.from;
  const message = callbackQuery?.message;
  const chatId = message?.chat?.id;

  if (!from || from.is_bot || !chatId || message.chat?.type !== "private") return;

  const access = resolveAccessFromEnv();
  if (isSetupMode(access) || !isUserAllowed(from.id, access)) return;

  const userId = String(from.id);

  let lock;
  try {
    lock = await acquireUserLock(userId, { waitMs: 1500 });
  } catch (error) {
    console.error("[store] lock gagal:", error?.message ?? "error tidak dikenal");
    lock = { acquired: true, release: async () => {} };
  }

  if (!lock.acquired) {
    await answerCallbackQuery(callbackQuery.id, { text: "sabar dikit yaa 🥺" }).catch(() => {});
    return;
  }

  try {
    await answerCallbackQuery(callbackQuery.id).catch(() => {});

    const session = await loadSessionSafe(userId);
    const result = handleCallback({ data: callbackQuery.data, session });

    if (result.changed) await safeSave(userId, session);

    try {
      await editMessageText(chatId, message.message_id, result.text, {
        replyMarkup: result.replyMarkup
      });
    } catch {
      await sendMessage(chatId, result.text, { replyMarkup: result.replyMarkup });
    }
  } finally {
    await lock.release();
  }
}
