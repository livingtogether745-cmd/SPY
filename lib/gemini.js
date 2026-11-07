import { optionalEnv, requireEnv } from "./security.js";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
export const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";

// Gemini occasionally returns 503 "high demand" or times out. Retry once
// with exponential backoff so a transient upstream spike does not surface as
// a user-facing error, while keeping the total wait bounded.
const MAX_ATTEMPTS = 2;
const PER_ATTEMPT_TIMEOUT_MS = 10_000;
const BASE_RETRY_DELAY_MS = 700;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryableNetworkError(error) {
  return error?.name === "TimeoutError" || error?.name === "AbortError" || error instanceof TypeError;
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

  const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent`;
  const body = {
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 0.9,
      topP: 0.95,
      maxOutputTokens: 512
    }
  };
  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(PER_ATTEMPT_TIMEOUT_MS)
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        const safeDetail = detail.replace(/\s+/g, " ").slice(0, 300);
        const error = new Error(`Gemini membalas HTTP ${response.status}${safeDetail ? `: ${safeDetail}` : ""}`);
        if (!RETRYABLE_STATUS.has(response.status) || attempt === MAX_ATTEMPTS) throw error;
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
      if (!isRetryableNetworkError(error) || attempt === MAX_ATTEMPTS) throw error;
      lastError = error;
    }

    await sleep(BASE_RETRY_DELAY_MS * 2 ** (attempt - 1));
  }

  throw lastError ?? new Error("Permintaan ke Gemini gagal");
}
