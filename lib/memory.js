/**
 * Long-term memory helpers.
 *
 * Memory is deliberately small and selective: only facts the user explicitly
 * shared are kept. Nothing here invents information. Every list is capped so a
 * single user cannot grow the prompt without bound.
 */

const MAX_ITEMS = 12;
const MAX_ITEM_CHARS = 120;
const MAX_NOTES = 8;

const PERSONAL_INFO_PATTERN =
  /(namaku|nama aku|panggil aku|panggilanku|aku suka|aku nggak suka|aku tidak suka|aku benci|hobiku|hobi aku|aku kerja|kerjaanku|aku tinggal|umurku|umur aku|ultah|ulang tahun|tanggal lahir|aku mahasiswa|aku kuliah|aku sekolah|aku punya|aku lagi|aku sedang|aku baru|aku pernah)/i;

export function createEmptyMemory() {
  return {
    profile: {
      nickname: "",
      age: "",
      location: "",
      job: ""
    },
    likes: [],
    dislikes: [],
    hobbies: [],
    important: [],
    notes: []
  };
}

function cleanText(value, maxLength = MAX_ITEM_CHARS) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeList(value, limit = MAX_ITEMS) {
  const source = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const seen = new Set();
  const result = [];

  for (const item of source) {
    const text = cleanText(item);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= limit) break;
  }

  return result;
}

export function normalizeMemory(raw) {
  const empty = createEmptyMemory();
  if (!raw || typeof raw !== "object") return empty;

  const profile = raw.profile && typeof raw.profile === "object" ? raw.profile : {};

  return {
    profile: {
      nickname: cleanText(profile.nickname),
      age: cleanText(profile.age, 32),
      location: cleanText(profile.location, 80),
      job: cleanText(profile.job, 80)
    },
    likes: normalizeList(raw.likes),
    dislikes: normalizeList(raw.dislikes),
    hobbies: normalizeList(raw.hobbies),
    important: normalizeList(raw.important, MAX_NOTES),
    notes: normalizeList(raw.notes, MAX_NOTES)
  };
}

function mergeList(base, patch, limit = MAX_ITEMS) {
  const seen = new Set();
  const result = [];

  for (const item of [...normalizeList(base, limit), ...normalizeList(patch, limit)]) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }

  return result;
}

/**
 * Merge an extracted patch into existing memory. Empty profile fields in the
 * patch never erase what is already known.
 */
export function mergeMemory(base, patch) {
  const current = normalizeMemory(base);
  const incoming = normalizeMemory(patch);

  return {
    profile: {
      nickname: incoming.profile.nickname || current.profile.nickname,
      age: incoming.profile.age || current.profile.age,
      location: incoming.profile.location || current.profile.location,
      job: incoming.profile.job || current.profile.job
    },
    likes: mergeList(current.likes, incoming.likes),
    dislikes: mergeList(current.dislikes, incoming.dislikes),
    hobbies: mergeList(current.hobbies, incoming.hobbies),
    important: mergeList(current.important, incoming.important, MAX_NOTES),
    notes: mergeList(current.notes, incoming.notes, MAX_NOTES)
  };
}

export function hasMemory(memory) {
  const normalized = normalizeMemory(memory);
  return Boolean(
    normalized.profile.nickname ||
      normalized.profile.age ||
      normalized.profile.location ||
      normalized.profile.job ||
      normalized.likes.length ||
      normalized.dislikes.length ||
      normalized.hobbies.length ||
      normalized.important.length ||
      normalized.notes.length
  );
}

/** Prompt-friendly memory block. Never contains invented facts. */
export function formatMemoryForPrompt(memory) {
  const normalized = normalizeMemory(memory);
  const lines = [];

  if (normalized.profile.nickname) lines.push(`- panggilan: ${normalized.profile.nickname}`);
  if (normalized.profile.age) lines.push(`- umur: ${normalized.profile.age}`);
  if (normalized.profile.location) lines.push(`- tinggal: ${normalized.profile.location}`);
  if (normalized.profile.job) lines.push(`- kerjaan/sekolah: ${normalized.profile.job}`);
  if (normalized.likes.length) lines.push(`- suka: ${normalized.likes.join(", ")}`);
  if (normalized.dislikes.length) lines.push(`- nggak suka: ${normalized.dislikes.join(", ")}`);
  if (normalized.hobbies.length) lines.push(`- hobi: ${normalized.hobbies.join(", ")}`);
  if (normalized.important.length) lines.push(`- hal penting: ${normalized.important.join("; ")}`);
  if (normalized.notes.length) lines.push(`- catatan: ${normalized.notes.join("; ")}`);

  if (!lines.length) {
    return "belum ada info yang dia ceritain. jangan mengarang ingatan.";
  }

  const text = lines.join("\n");
  return text.length > 2400 ? text.slice(0, 2400) : text;
}

/** Human-readable memory list used by /memory. */
export function formatMemoryReport(memory) {
  return formatMemoryForPrompt(memory);
}

export function buildMemoryExtractionPrompt({ memory, recentMessages = [], userText = "" }) {
  const existing = JSON.stringify(normalizeMemory(memory));
  const transcript = recentMessages.length
    ? recentMessages.map((line) => `- ${cleanText(line, 300)}`).join("\n")
    : "- belum ada";

  return `Kamu adalah pencatat memori percakapan. Tugasmu hanya mencatat fakta yang benar-benar disebutkan user.

Kembalikan HANYA JSON valid, tanpa penjelasan, tanpa markdown, dengan bentuk:
{
  "profile": { "nickname": "", "age": "", "location": "", "job": "" },
  "likes": [],
  "dislikes": [],
  "hobbies": [],
  "important": [],
  "notes": []
}

Aturan:
- hanya catat fakta eksplisit dari pesan user atau percakapan terakhir
- jangan mengarang, jangan menebak, jangan menyimpulkan hal yang tidak disebut
- kalau tidak ada info baru, biarkan field kosong dan array kosong
- tulis singkat, maksimal 80 karakter per item
- jangan catat password, token, alamat lengkap, data keuangan, atau info sensitif lain
- "important" untuk cerita atau rencana penting, "notes" untuk detail kecil yang berguna
- jangan masukkan sapaan, basa-basi, atau emosi sesaat

Memori yang sudah ada:
${existing}

Percakapan terakhir:
${transcript}

Pesan terbaru user:
${cleanText(userText, 1500)}`;
}

/** Extract the first JSON object from a model reply. */
export function parseJsonObject(text) {
  if (typeof text !== "string") throw new Error("JSON kosong");
  const withoutFence = text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("JSON tidak ditemukan");
  return JSON.parse(withoutFence.slice(start, end + 1));
}

/**
 * Ask the model for a memory patch. `generateJsonImpl` is injected so tests do
 * not need network access.
 */
export async function extractMemoryPatch({
  memory,
  recentMessages = [],
  userText = "",
  generateJsonImpl
}) {
  if (typeof generateJsonImpl !== "function") {
    throw new Error("generateJsonImpl wajib diisi");
  }

  const prompt = buildMemoryExtractionPrompt({ memory, recentMessages, userText });
  const raw = await generateJsonImpl(prompt, {
    temperature: 0.2,
    maxOutputTokens: 350,
    timeoutMs: 8000,
    maxAttempts: 1
  });

  const parsed = typeof raw === "string" ? parseJsonObject(raw) : raw;
  return normalizeMemory(parsed);
}

/**
 * Extract every 4th user message, or immediately when the message looks like
 * personal information worth remembering.
 */
export function shouldExtractMemory({ text = "", userMessageCount = 0 } = {}) {
  const count = Number.isFinite(userMessageCount) ? userMessageCount : 0;
  if ((count + 1) % 4 === 0) return true;
  return PERSONAL_INFO_PATTERN.test(text);
}
