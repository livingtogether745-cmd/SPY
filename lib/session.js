/**
 * Per-user conversation state.
 *
 * One JSON document per Telegram user keeps Redis traffic low:
 * settings + short-term history + summary + long-term memory + counters.
 * Every user is isolated by `spy:session:<userId>`.
 */

import {
  getJson,
  setJson,
  del,
  setIfAbsent,
  incrWithTtl
} from "./store.js";
import {
  optionalEnv,
  sanitizeDisplayName,
  truncate
} from "./security.js";
import {
  applyPreset,
  isPreset
} from "./presets.js";
import {
  createEmptyMemory,
  normalizeMemory
} from "./memory.js";

export const SESSION_VERSION = 2;
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 90;

// Stored history is deliberately larger than the slice sent to the model, so a
// summary can be produced before old turns are discarded.
export const MAX_HISTORY_MESSAGES = 40;
export const CONTEXT_MESSAGES = 16;
export const SUMMARY_TRIGGER_MESSAGES = 32;
export const SUMMARY_KEEP_MESSAGES = 12;
export const MAX_SUMMARY_CHARS = 3000;

export const PENDING_TTL_MS = 2 * 60 * 1000;

const RATE_LIMIT_DEFAULT = 20;
const RATE_WINDOW_SECONDS_DEFAULT = 60;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function clamp01(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(1, Math.max(0, number));
}

export function defaultSettings() {
  const envPreset = optionalEnv("DEFAULT_PRESET");
  const preset = isPreset(envPreset) ? envPreset : "sweet";
  const characterName = sanitizeDisplayName(optionalEnv("CHARACTER_NAME"), 24) || "Ayu";

  const base = {
    characterName,
    userName: "kamu",
    language: "id",
    preset,
    clinginess: 0.7,
    romance: 0.7,
    humor: 0.6,
    emoji: 0.6,
    replyLength: "auto"
  };

  return applyPreset(base, preset);
}

export function normalizeSettings(raw) {
  const defaults = defaultSettings();
  if (!raw || typeof raw !== "object") return defaults;

  const preset = isPreset(raw.preset) ? raw.preset : defaults.preset;
  const base = applyPreset(defaults, preset);

  return {
    ...base,
    characterName: sanitizeDisplayName(raw.characterName, 24) || base.characterName,
    userName: sanitizeDisplayName(raw.userName, 24) || base.userName,
    language: ["id", "en", "mix"].includes(raw.language) ? raw.language : base.language,
    preset,
    clinginess: clamp01(raw.clinginess, base.clinginess),
    romance: clamp01(raw.romance, base.romance),
    humor: clamp01(raw.humor, base.humor),
    emoji: clamp01(raw.emoji, base.emoji),
    replyLength: ["short", "auto", "medium", "long"].includes(raw.replyLength)
      ? raw.replyLength
      : base.replyLength
  };
}

export function defaultSession(now = Date.now()) {
  return {
    version: SESSION_VERSION,
    createdAt: now,
    updatedAt: now,
    settings: defaultSettings(),
    history: [],
    summary: "",
    memory: createEmptyMemory(),
    counters: { userMessages: 0 },
    pending: null
  };
}

function normalizeHistory(raw) {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      role: entry.role === "model" ? "model" : "user",
      text: truncate(entry.text, 4000),
      at: Number(entry.at) || 0
    }))
    .filter((entry) => entry.text)
    .slice(-MAX_HISTORY_MESSAGES);
}

function normalizePending(raw, now) {
  const at = Number(raw?.clearMemoryAt);
  if (!Number.isFinite(at) || at <= 0) return null;
  if (now - at > PENDING_TTL_MS) return null;
  return { clearMemoryAt: at };
}

export function normalizeSession(raw, now = Date.now()) {
  const fallback = defaultSession(now);
  if (!raw || typeof raw !== "object") return fallback;

  return {
    version: SESSION_VERSION,
    createdAt: Number(raw.createdAt) || now,
    updatedAt: Number(raw.updatedAt) || now,
    settings: normalizeSettings(raw.settings),
    history: normalizeHistory(raw.history),
    summary: typeof raw.summary === "string" ? raw.summary.slice(0, MAX_SUMMARY_CHARS) : "",
    memory: normalizeMemory(raw.memory),
    counters: {
      userMessages: Math.max(0, Math.trunc(Number(raw.counters?.userMessages) || 0))
    },
    pending: normalizePending(raw.pending, now)
  };
}

export function sessionKey(userId) {
  return `spy:session:${userId}`;
}

export async function loadSession(userId) {
  const raw = await getJson(sessionKey(userId));
  return normalizeSession(raw);
}

export async function saveSession(userId, session) {
  const normalized = normalizeSession(session);
  normalized.updatedAt = Date.now();
  await setJson(sessionKey(userId), normalized, SESSION_TTL_SECONDS);
  return normalized;
}

export function appendExchange(session, userText, replyText, now = Date.now()) {
  const user = truncate(userText, 4000);
  const reply = truncate(replyText, 4000);

  if (user) session.history.push({ role: "user", text: user, at: now });
  if (reply) session.history.push({ role: "model", text: reply, at: now });

  if (session.history.length > MAX_HISTORY_MESSAGES) {
    session.history = session.history.slice(-MAX_HISTORY_MESSAGES);
  }
  session.updatedAt = now;
}

export function resetConversation(session) {
  session.history = [];
  session.summary = "";
  session.pending = null;
  session.updatedAt = Date.now();
  return session;
}

export function clearLongTermMemory(session) {
  session.memory = createEmptyMemory();
  session.pending = null;
  session.updatedAt = Date.now();
  return session;
}

export function setClearMemoryPending(session) {
  session.pending = { clearMemoryAt: Date.now() };
  return session;
}

export function clearPending(session) {
  session.pending = null;
  return session;
}

/** True only once per Telegram update_id. */
export async function markUpdateProcessed(updateId, ttlSeconds = 600) {
  if (!Number.isFinite(Number(updateId))) return true;
  return setIfAbsent(`spy:update:${updateId}`, "1", ttlSeconds);
}

export async function checkRateLimit(userId, options = {}) {
  const limit = options.limit ?? RATE_LIMIT_DEFAULT;
  const windowSeconds = options.windowSeconds ?? RATE_WINDOW_SECONDS_DEFAULT;
  const count = await incrWithTtl(`spy:rate:${userId}`, windowSeconds);
  return { allowed: count <= limit, count, limit, windowSeconds };
}

/**
 * Serialize work per user. If another invocation is still handling a message,
 * wait briefly instead of processing two turns concurrently (which would
 * reorder history and produce swapped replies).
 */
export async function acquireUserLock(userId, options = {}) {
  const key = `spy:lock:${userId}`;
  const ttlSeconds = options.ttlSeconds ?? 45;
  const waitMs = options.waitMs ?? 4000;
  const intervalMs = options.intervalMs ?? 250;
  const sleep = options.sleep ?? defaultSleep;
  const deadline = Date.now() + waitMs;

  for (;;) {
    if (await setIfAbsent(key, "1", ttlSeconds)) {
      return {
        acquired: true,
        async release() {
          await del(key);
        }
      };
    }

    if (Date.now() >= deadline) {
      return {
        acquired: false,
        async release() {}
      };
    }

    await sleep(intervalMs);
  }
}

export function needsSummary(history) {
  return Array.isArray(history) && history.length >= SUMMARY_TRIGGER_MESSAGES;
}

export function buildSummaryPrompt({ history, previousSummary = "" }) {
  const transcript = (history ?? [])
    .map((entry) => `${entry.role === "user" ? "user" : "kamu"}: ${truncate(entry.text, 600)}`)
    .join("\n");

  return `Ringkas percakapan berikut menjadi catatan konteks yang padat untuk melanjutkan obrolan.

Pertahankan:
- nama panggilan, pekerjaan, sekolah, atau kegiatan yang sedang dibahas
- topik utama dan hal yang sedang dikerjakan
- perasaan atau suasana hati user
- rencana, janji, atau hal penting yang ingin diingat
- detail spesifik yang membuat balasan berikutnya nyambung

Jangan mengarang. Jangan menambahkan fakta yang tidak ada di percakapan. Jangan menulis sapaan atau basa-basi. Maksimal 180 kata.

Ringkasan sebelumnya:
${previousSummary || "belum ada"}

Percakapan:
${transcript}`;
}

/**
 * Summarize older turns and return the trimmed history that should replace it.
 * The injected generator keeps this module testable without network access.
 */
export async function summarizeHistory({
  history,
  previousSummary = "",
  generateImpl,
  keep = SUMMARY_KEEP_MESSAGES
}) {
  if (typeof generateImpl !== "function") throw new Error("generateImpl wajib diisi");
  if (!Array.isArray(history) || history.length <= keep) return null;

  const older = history.slice(0, history.length - keep);
  if (older.length < 4) return null;

  const prompt = buildSummaryPrompt({ history: older, previousSummary });
  const summary = await generateImpl(prompt, {
    systemPrompt: "Kamu adalah peringkas percakapan yang faktual. Balas hanya dengan ringkasan singkat.",
    temperature: 0.3,
    maxOutputTokens: 320,
    timeoutMs: 8000,
    maxAttempts: 1
  });

  const text = typeof summary === "string" ? summary.trim() : "";
  if (!text) return null;

  return {
    summary: text.slice(0, MAX_SUMMARY_CHARS),
    keptHistory: history.slice(-keep)
  };
}

/** Compact transcript used by memory extraction. */
export function buildRecentTranscript(history, limit = 6) {
  return (history ?? [])
    .slice(-limit)
    .map((entry) => `${entry.role === "user" ? "user" : "kamu"}: ${truncate(entry.text, 400)}`);
}
