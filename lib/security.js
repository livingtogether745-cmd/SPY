import crypto from "node:crypto";

/**
 * Read a required environment variable without ever logging its value.
 * Throws a short error that is safe to print.
 */
export function requireEnv(name) {
  const value = process.env[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Environment variable wajib belum diisi: ${name}`);
  }
  return value.trim();
}

/** Optional env var, trimmed, or an empty string. */
export function optionalEnv(name) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

/** Constant-time string comparison for webhook secrets. */
export function secretsMatch(received, expected) {
  if (typeof received !== "string" || typeof expected !== "string") return false;
  const a = Buffer.from(received, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Hard limit on untrusted input before it reaches the LLM. */
export function truncate(text, maxLength) {
  if (typeof text !== "string") return "";
  const clean = text.replace(/\u0000/g, "").trim();
  return clean.length > maxLength ? clean.slice(0, maxLength) : clean;
}

/** Safe display name for character/user nicknames. Never used as a key. */
export function sanitizeDisplayName(value, maxLength = 24) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

/** Parse a comma/space separated Telegram ID allowlist. */
export function parseIdList(value) {
  if (typeof value !== "string") return [];
  return value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter((item) => /^-?\d+$/.test(item));
}

/**
 * Access policy:
 * - TELEGRAM_ALLOWED_IDS set  -> only those IDs
 * - TELEGRAM_PUBLIC=true      -> everyone
 * - TELEGRAM_OWNER_ID set     -> owner only (backward compatible)
 * - nothing set               -> setup mode, only /start and /id
 */
export function resolveAccessFromEnv() {
  const allowedIds = new Set(parseIdList(optionalEnv("TELEGRAM_ALLOWED_IDS")));
  const ownerId = optionalEnv("TELEGRAM_OWNER_ID");
  const isPublic = optionalEnv("TELEGRAM_PUBLIC").toLowerCase() === "true";

  return { allowedIds, ownerId, isPublic };
}

export function isSetupMode(access) {
  return !access?.isPublic && !access?.ownerId && !(access?.allowedIds?.size > 0);
}

export function isUserAllowed(userId, access) {
  const id = String(userId ?? "");
  if (!id) return false;
  if (access?.allowedIds?.size > 0) return access.allowedIds.has(id);
  if (access?.isPublic) return true;
  if (access?.ownerId) return id === access.ownerId;
  return false;
}

/**
 * Read a JSON request body in a way that works both with Vercel's parsed
 * body and with a raw Node stream.
 */
export async function readJsonBody(req) {
  if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString("utf8"));
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);

  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}
