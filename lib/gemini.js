import { optionalEnv, requireEnv } from "./security.js";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
export const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";

/**
 * Single outbound LLM call. The API key is sent in the x-goog-api-key header,
 * never in the URL, so it is less likely to appear in access logs.
 */
export async function generateReply(userText, options = {}) {
  const apiKey = options.apiKey ?? requireEnv("GEMINI_API_KEY");
  const model = options.model || optionalEnv("GEMINI_MODEL") || DEFAULT_GEMINI_MODEL;
  const systemPrompt = options.systemPrompt ?? "";

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

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const safeDetail = detail.replace(/\s+/g, " ").slice(0, 300);
    throw new Error(`Gemini HTTP ${response.status}${safeDetail ? `: ${safeDetail}` : ""}`);
  }

  const data = await response.json();
  const candidate = data?.candidates?.[0];
  const text = candidate?.content?.parts
    ?.map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("")
    .trim();

  if (!text) {
    const reason = data?.promptFeedback?.blockReason ?? candidate?.finishReason ?? "empty_response";
    throw new Error(`Gemini returned no text (${reason})`);
  }

  return text;
}
