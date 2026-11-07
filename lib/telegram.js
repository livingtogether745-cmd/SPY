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
    throw new Error(`Telegram ${method} gagal: ${description}`);
  }
  return data.result;
}

export async function sendMessage(chatId, text, options = {}) {
  const token = options.token ?? requireEnv("TELEGRAM_BOT_TOKEN");
  const safeText = typeof text === "string" ? text.trim().slice(0, 4096) : "";
  if (!safeText) return null;

  const payload = {
    chat_id: chatId,
    text: safeText,
    disable_web_page_preview: true
  };
  if (options.replyMarkup) payload.reply_markup = options.replyMarkup;

  return telegramRequest(token, "sendMessage", payload);
}

export async function editMessageText(chatId, messageId, text, options = {}) {
  const token = options.token ?? requireEnv("TELEGRAM_BOT_TOKEN");
  const safeText = typeof text === "string" ? text.trim().slice(0, 4096) : "";
  if (!safeText) return null;

  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text: safeText,
    disable_web_page_preview: true
  };
  if (options.replyMarkup) payload.reply_markup = options.replyMarkup;

  return telegramRequest(token, "editMessageText", payload);
}

export async function answerCallbackQuery(callbackQueryId, options = {}) {
  const token = options.token ?? requireEnv("TELEGRAM_BOT_TOKEN");
  const payload = { callback_query_id: callbackQueryId };
  if (typeof options.text === "string" && options.text.trim()) {
    payload.text = options.text.trim().slice(0, 200);
  }
  if (options.showAlert) payload.show_alert = true;

  return telegramRequest(token, "answerCallbackQuery", payload);
}

export async function sendChatAction(chatId, action = "typing", options = {}) {
  const token = options.token ?? requireEnv("TELEGRAM_BOT_TOKEN");
  return telegramRequest(token, "sendChatAction", {
    chat_id: chatId,
    action
  });
}

/**
 * Target duration for the "typing" indicator based on reply length.
 * Base 350ms + 12ms per character, capped at 2.5s so long replies never
 * feel artificially slow.
 */
export function calculateTypingDelay(charCount, options = {}) {
  const baseMs = options.baseMs ?? 350;
  const perCharMs = options.perCharMs ?? 12;
  const maxMs = options.maxMs ?? 2500;
  const count = Number.isFinite(charCount) && charCount > 0 ? charCount : 0;
  return Math.min(maxMs, Math.round(baseMs + count * perCharMs));
}

/**
 * Wait only for the remaining part of the target duration. Generation time
 * already spent is subtracted, so the LLM call is never delayed by this.
 */
export async function waitForTyping(charCount, elapsedMs = 0, options = {}) {
  const targetMs = calculateTypingDelay(charCount, options);
  const remainingMs = Math.max(0, targetMs - Math.max(0, elapsedMs));
  if (remainingMs > 0) {
    const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    await sleep(remainingMs);
  }
  return remainingMs;
}

/**
 * Show Telegram's native "typing..." indicator immediately and refresh it
 * every 4 seconds (Telegram clears it after ~5s). Errors are ignored so a
 * failed typing indicator never blocks the actual reply.
 */
export function startTyping(chatId, options = {}) {
  const intervalMs = options.intervalMs ?? 4000;
  const sendAction = options.sendAction ?? ((id, action) => sendChatAction(id, action, options));
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    Promise.resolve(sendAction(chatId, "typing")).catch(() => {});
  };

  tick();
  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === "function") timer.unref();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    }
  };
}

export async function setWebhook({ token, url, secretToken }) {
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN wajib diisi");
  if (!url) throw new Error("URL webhook wajib diisi");
  if (!secretToken) throw new Error("TELEGRAM_WEBHOOK_SECRET wajib diisi");

  return telegramRequest(token, "setWebhook", {
    url,
    secret_token: secretToken,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true
  });
}

export async function getWebhookInfo({ token }) {
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN wajib diisi");
  return telegramRequest(token, "getWebhookInfo", {});
}
