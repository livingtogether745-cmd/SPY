import { getWebhookInfo, setWebhook } from "../lib/telegram.js";
import { requireEnv } from "../lib/security.js";

const baseUrl = process.argv[2] || process.env.PUBLIC_BASE_URL || "";
if (!baseUrl) {
  console.error("Usage: node scripts/set-webhook.mjs https://your-project.vercel.app");
  process.exit(1);
}

try {
  const token = requireEnv("TELEGRAM_BOT_TOKEN");
  const secretToken = requireEnv("TELEGRAM_WEBHOOK_SECRET");
  const url = `${baseUrl.replace(/\/+$/, "")}/api/webhook`;

  await setWebhook({ token, url, secretToken });
  const info = await getWebhookInfo({ token });

  console.log(JSON.stringify({
    ok: true,
    url: info.url,
    pending_update_count: info.pending_update_count,
    last_error_message: info.last_error_message ?? null
  }, null, 2));
} catch (error) {
  console.error(`set-webhook failed: ${error?.message ?? "unknown_error"}`);
  process.exitCode = 1;
}
