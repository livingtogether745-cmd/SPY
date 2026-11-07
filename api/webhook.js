import { generateReply } from "../lib/gemini.js";
import { sendMessage } from "../lib/telegram.js";
import { buildSystemPrompt } from "../lib/persona.js";
import {
  optionalEnv,
  readJsonBody,
  secretsMatch,
  truncate
} from "../lib/security.js";

const MAX_INPUT_CHARS = 4000;
const GENERIC_ERROR = "Maaf, aku lagi ada gangguan. Coba lagi sebentar ya.";

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
    await handleUpdate(update);
  } catch (error) {
    // Never log message contents or environment values.
    console.error("[webhook]", error?.message ?? "error tidak dikenal");
  }

  // Always acknowledge valid webhook calls so Telegram does not retry in a loop.
  res.status(200).json({ ok: true });
}

async function handleUpdate(update) {
  const message = update?.message;
  if (!message || !message.from || message.from.is_bot) return;
  if (message.chat?.type !== "private") return;

  const fromId = message.from.id;
  const chatId = message.chat.id;
  const ownerId = optionalEnv("TELEGRAM_OWNER_ID");
  const text = truncate(message.text ?? "", MAX_INPUT_CHARS);

  // Setup mode: no owner configured yet. Only /start and /id are allowed.
  if (!ownerId) {
    if (text === "/start") {
      await sendMessage(
        chatId,
        "Bot aktif. Kirim /id untuk melihat Telegram ID kamu, lalu set TELEGRAM_OWNER_ID di Vercel dan redeploy."
      );
      return;
    }
    if (text === "/id") {
      await sendMessage(
        chatId,
        `Telegram ID kamu: ${fromId}\n\nSet TELEGRAM_OWNER_ID=${fromId} di Vercel, lalu redeploy.`
      );
      return;
    }
    await sendMessage(chatId, "Bot belum dikonfigurasi. Set TELEGRAM_OWNER_ID dulu.");
    return;
  }

  // Owner allowlist. Strangers are silently ignored, so the bot cannot be
  // used to burn API quota or probe the persona.
  if (String(fromId) !== ownerId) return;

  if (text === "/start") {
    await sendMessage(chatId, "Hai. Bot siap. Kirim pesan biasa aja.");
    return;
  }
  if (text === "/id") {
    await sendMessage(chatId, `Telegram ID kamu: ${fromId}`);
    return;
  }
  if (text === "/help") {
    await sendMessage(chatId, "Kirim pesan teks biasa aja. Nanti aku balas.");
    return;
  }
  if (text.startsWith("/")) {
    await sendMessage(chatId, "Perintah itu belum ada.");
    return;
  }
  if (!text) {
    await sendMessage(chatId, "Aku cuma bisa baca teks dulu ya.");
    return;
  }

  try {
    const reply = await generateReply(text, { systemPrompt: buildSystemPrompt() });
    await sendMessage(chatId, reply);
  } catch (error) {
    console.error("[gemini]", error?.message ?? "error tidak dikenal");
    await sendMessage(chatId, GENERIC_ERROR);
  }
}
