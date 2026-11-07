import { requireEnv } from "./security.js";

const TELEGRAM_API_BASE = "https://api.telegram.org";

function botUrl(token, method) {
  return `${TELEGRAM_API_BASE}/bot${token}/${method}`;
}

async function telegramRequest(token, method, payload, timeoutMs = 10_000) {
  const response = await fetch(botUrl(token, method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs)
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    const description = data?.description ?? `HTTP ${response.status}`;
    throw new Error(`Telegram ${method} failed: ${description}`);
  }
  return data.result;
}

export async function sendMessage(chatId, text, options = {}) {
  const token = options.token ?? requireEnv("TELEGRAM_BOT_TOKEN");
  const safeText = typeof text === "string" ? text.trim().slice(0, 4096) : "";
  if (!safeText) return null;

  return telegramRequest(token, "sendMessage", {
    chat_id: chatId,
    text: safeText,
    disable_web_page_preview: true
  });
}

export async function setWebhook({ token, url, secretToken }) {
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");
  if (!url) throw new Error("Webhook URL is required");
  if (!secretToken) throw new Error("TELEGRAM_WEBHOOK_SECRET is required");

  return telegramRequest(token, "setWebhook", {
    url,
    secret_token: secretToken,
    allowed_updates: ["message"],
    drop_pending_updates: true
  });
}

export async function getWebhookInfo({ token }) {
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");
  return telegramRequest(token, "getWebhookInfo", {});
}
