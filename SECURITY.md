# Security Notes

## Audit scope

The original `SPY` repository was empty at audit time (0 commits, 0 files), so there was no existing code, dependency tree, or network behavior to review. This project was created as a minimal replacement and audited by static review plus local unit tests. It has **not** been run against live Telegram or Gemini endpoints in this environment.

## Outbound network calls

The code can only contact:

1. `https://api.telegram.org` — receive/send Telegram messages and register the webhook.
2. `https://generativelanguage.googleapis.com` — call Gemini.

No analytics, telemetry, CDN, tracking pixel, external UI, or third-party API is used.

## Secret handling

- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_OWNER_ID`, and `GEMINI_API_KEY` are read from environment variables only.
- No secret is written to source, `vercel.json`, tests, or logs.
- The Gemini key is sent in the `x-goog-api-key` header, not in the URL query string.
- `.env` and `.env.*` are ignored by git; only `.env.example` is committed.
- Error logging prints only a short error message, never environment values or message contents.

## Access control

- Telegram webhook requests must include the exact `X-Telegram-Bot-Api-Secret-Token` header. Comparison is constant-time.
- If `TELEGRAM_WEBHOOK_SECRET` is missing, the webhook fails closed with HTTP 500.
- Only private chats are handled.
- After `TELEGRAM_OWNER_ID` is set, messages from every other account are silently ignored.
- Before the owner is configured, only `/start` and `/id` are answered; the LLM is never called.
- Input is truncated to 4000 characters before reaching the LLM.
- Outbound requests have timeouts (10s Telegram, 25s Gemini) and the Vercel function is capped at 60s.

## Data handling

- The bot is stateless. It does not store messages, user profiles, or conversation history.
- Vercel may retain platform logs according to its own policy. This code does not log message text.
- Gemini receives the user's message and the system prompt. Review Google's API data policy before production use.

## Known limitations

- No conversation memory across messages.
- No rate limiting beyond the owner allowlist. A compromised owner account could consume Gemini quota.
- The default persona is a role-play character. It must not be used for impersonation, harassment, or deception.
- A serverless deployment is only as private as the Vercel project and the Telegram bot token. Rotate both if exposed.
- The provided API key was shared in chat and must be treated as compromised. Revoke it and create a new one.

## Verification performed

- `npm run check` — syntax check for every JavaScript entry point.
- `npm test` — unit tests for secret comparison, input truncation, persona safety text, and default model name.
- Static review of all outbound `fetch` calls and environment variable usage.

## Reporting

If you find a vulnerability, do not open a public issue with exploit details. Contact the repository owner privately and rotate any exposed credentials first.
