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
