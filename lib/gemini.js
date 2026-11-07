import { optionalEnv, requireEnv } from "./security.js";
import { parseJsonObject } from "./memory.js";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// gemini-3.1-flash-lite was measured at ~44s for a short prompt, while
// gemini-3.5-flash answered in ~3.5s. The fast model is the default so a
// deployment without GEMINI_MODEL still gets low latency.
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";

// Gemini occasionally returns 503 "high demand" or times out. Retry once with
// exponential backoff so a transient upstream spike does not surface as a
// user-facing error, while keeping the total wait bounded.
const MAX_ATTEMPTS = 2;
const PER_ATTEMPT_TIMEOUT_MS = 10_000;
const BASE_RETRY_DELAY_MS = 700;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

// Bounded context sent to the model. The session may keep more turns so a
// summary can be built, but only this slice is ever transmitted.
const MAX_CONTEXT_MESSAGES = 16;
const MAX_CONTEXT_CHARS = 12_000;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryableNetworkError(error) {
  return error?.name === "TimeoutError" || error?.name === "AbortError" || error instanceof TypeError;
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const text = typeof entry.text === "string" ? entry.text.trim() : "";
  if (!text) return null;
  return { role: entry.role === "model" ? "model" : "user", text };
}

/**
 * Build Gemini `contents` from short-term history plus the current message.
 * Oldest turns are dropped first when the character budget is exceeded.
 */
export function buildContents(history, userText) {
  const current = typeof userText === "string" ? userText.trim() : "";
  const entries = Array.isArray(history)
    ? history.slice(-MAX_CONTEXT_MESSAGES).map(normalizeEntry).filter(Boolean)
    : [];

  let total = current.length;
  const kept = [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (total + entry.text.length > MAX_CONTEXT_CHARS) break;
    kept.unshift(entry);
    total += entry.text.length;
  }

  const merged = [];
  for (const entry of kept) {
    const last = merged[merged.length - 1];
    if (last && last.role === entry.role) {
      last.text = `${last.text}\n${entry.text}`;
    } else {
      merged.push({ ...entry });
    }
  }

  // Gemini expects the conversation to start with a user turn.
  while (merged.length && merged[0].role !== "user") merged.shift();

  const contents = merged.map((entry) => ({
    role: entry.role,
    parts: [{ text: entry.text }]
  }));

  const last = contents[contents.length - 1];
  if (last && last.role === "user") {
    last.parts[0].text = `${last.parts[0].text}\n${current}`;
  } else if (current) {
    contents.push({ role: "user", parts: [{ text: current }] });
  }

  return contents;
}

/**
 * Single outbound LLM call with bounded retries. The API key is sent in the
 * x-goog-api-key header, never in the URL, so it is less likely to appear in
 * access logs.
 */
export async function generateReply(userText, options = {}) {
  const apiKey = options.apiKey ?? requireEnv("GEMINI_API_KEY");
  const model = options.model || optionalEnv("GEMINI_MODEL") || DEFAULT_GEMINI_MODEL;
  const systemPrompt = options.systemPrompt ?? "";
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = Math.max(1, Math.trunc(options.maxAttempts ?? MAX_ATTEMPTS));
  const timeoutMs = Math.max(1000, Math.trunc(options.timeoutMs ?? PER_ATTEMPT_TIMEOUT_MS));
  const retryDelayMs = Math.max(0, Math.trunc(options.retryDelayMs ?? BASE_RETRY_DELAY_MS));

  const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent`;
  const body = {
    contents: buildContents(options.history, userText),
    generationConfig: {
      temperature: Number.isFinite(options.temperature) ? options.temperature : 0.9,
      topP: Number.isFinite(options.topP) ? options.topP : 0.95,
      maxOutputTokens: Math.max(64, Math.trunc(options.maxOutputTokens ?? 512))
    }
  };
  if (options.json) {
    body.generationConfig.responseMimeType = "application/json";
  }
  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        const safeDetail = detail.replace(/\s+/g, " ").slice(0, 300);
        const error = new Error(`Gemini membalas HTTP ${response.status}${safeDetail ? `: ${safeDetail}` : ""}`);
        if (!RETRYABLE_STATUS.has(response.status) || attempt === maxAttempts) throw error;
        lastError = error;
      } else {
        const data = await response.json();
        const candidate = data?.candidates?.[0];
        const text = candidate?.content?.parts
          ?.map((part) => (typeof part?.text === "string" ? part.text : ""))
          .join("")
          .trim();

        if (!text) {
          const reason = data?.promptFeedback?.blockReason ?? candidate?.finishReason ?? "empty_response";
          throw new Error(`Gemini tidak mengembalikan teks (${reason})`);
        }

        return text;
      }
    } catch (error) {
      if (!isRetryableNetworkError(error) || attempt === maxAttempts) throw error;
      lastError = error;
    }

    await sleep(retryDelayMs * 2 ** (attempt - 1));
  }

  throw lastError ?? new Error("Permintaan ke Gemini gagal");
}

/** Convenience wrapper for prompts that must return one JSON object. */
export async function generateJson(prompt, options = {}) {
  const text = await generateReply(prompt, { ...options, json: true });
  return parseJsonObject(text);
}
