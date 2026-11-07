# Security Notes

## Audit scope

The original `SPY` repository was empty at audit time (0 commits, 0 files), so there was no existing code, dependency tree, or network behavior to review. The project was built from scratch with no npm dependencies and then extended with per-user memory, character presets, commands, and an anti-disclosure guard.

The current upgrade was verified by static review plus local tests only. It has **not** been committed, pushed, or deployed. The last production deployment used the earlier stateless version.

## Outbound network calls

The code can only contact:

1. `https://api.telegram.org` — receive/send Telegram messages, callbacks, and typing actions.
2. `https://generativelanguage.googleapis.com` — call Gemini for replies, summaries, and memory extraction.
3. The Redis REST endpoint configured through `UPSTASH_REDIS_REST_URL` / `KV_REST_API_URL` — store per-user sessions.

No analytics, telemetry, CDN, tracking pixel, external UI, or third-party API is used.

## Secret handling

- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `GEMINI_API_KEY`, Redis URLs/tokens, and access IDs are read from environment variables only.
- No secret is written to source, `vercel.json`, tests, or logs.
- The Gemini key is sent in the `x-goog-api-key` header, not in the URL query string.
- Redis credentials are sent in the `Authorization: Bearer` header.
- `.env` and `.env.*` are ignored by git; only `.env.example` is committed.
- Error logging prints only a short error message, never environment values or message contents.
- Memory-extraction and summary failures are logged without user text.

## Access control

- Telegram webhook requests must include the exact `X-Telegram-Bot-Api-Secret-Token` header. Comparison is constant-time.
- If `TELEGRAM_WEBHOOK_SECRET` is missing, the webhook fails closed with HTTP 500.
- Only private chats are handled.
- Access policy, in priority order:
  1. `TELEGRAM_ALLOWED_IDS` — only listed numeric IDs.
  2. `TELEGRAM_PUBLIC=true` — anyone, still rate-limited.
  3. `TELEGRAM_OWNER_ID` — owner only (backward compatible).
  4. Nothing set — setup mode: only `/start` and `/id`, the LLM is never called.
- Inline callbacks are authorized using `callback_query.from.id`, not the message owner.
- Callbacks from groups or channels are ignored.
- Each user is serialized with a short Redis lock so two rapid messages cannot interleave history.
- Rate limit: 20 messages per 60 seconds per user. Commands bypass the LLM rate limit.
- Duplicate `update_id` values are ignored for 10 minutes.
- Input is truncated to 4000 characters before reaching the LLM.
- Outbound requests have timeouts (10s Telegram, 10s per Gemini attempt, 5s Redis) and the Vercel function is capped at 60s.
- Transient Gemini failures (HTTP 408/425/429/500/502/503/504 and network timeouts) are retried up to 2 times with exponential backoff. Non-retryable errors (e.g. 400/401/403/404) and safety blocks fail immediately.
- Memory extraction and summary calls use one attempt with an 8s timeout so they cannot extend the response path indefinitely.

## Data handling

Each Telegram user has one session document:

```
spy:session:<telegram_user_id>
```

It contains:

- character/user settings (name, nickname, language, preset, intensity);
- short-term history (up to 40 messages);
- a rolling summary of older conversation;
- selective long-term memory (profile, likes, dislikes, hobbies, important notes);
- counters and a short-lived clear-memory confirmation flag.

Properties:

- Keys are namespaced by Telegram user ID. One user cannot read or mutate another user's session through commands.
- Session TTL is 90 days, refreshed on each save.
- Update-dedupe keys expire after 10 minutes; rate-limit keys after 60 seconds; locks after 45 seconds.
- Message text is not written to application logs.
- Gemini receives the system prompt, bounded recent history, the current message, and (on extraction turns) a compact transcript. Review Google's API data policy before production use.
- Redis stores conversation content. Use a private database, TLS REST endpoint, and rotate the token if exposed.

If Redis is not configured, the code falls back to an in-memory `Map`. This is suitable for local tests only: serverless instances do not share memory, so users may see inconsistent memory and data is lost on restart.

## Roleplay and content safety

- The system prompt keeps the character positive, non-manipulative, and non-isolating. It explicitly forbids guilt-tripping, threats, insults, and pressure to abandon real-life relationships.
- The prompt forbids explicit sexual content and redirects intimate conversations.
- The prompt forbids dangerous, illegal, or privacy-violating instructions.
- `lib/guard.js` replaces any reply that discloses an AI/bot/model/program identity, mentions a model provider, or discusses prompts/system instructions. The replacement is an in-character deflection, never a technical explanation.
- The guard also strips markdown that would render badly in plain Telegram text.
- The guard is a deterministic safety net, not a full content moderation system. There is no separate classifier for harassment, self-harm, or illegal content.

## Known limitations

- No prompt-builder mode exists, so `/mode prompt` is intentionally not implemented.
- Persistent production memory requires Redis credentials. Without them, memory is best-effort only.
- Memory extraction is LLM-based. If Gemini fails during extraction, the reply is still delivered but that turn's facts are not saved.
- Rate limiting is simple and per-user; it is not a defense against distributed abuse.
- There is no admin dashboard or remote audit log.
- The character is a roleplay persona. It must not be used for impersonation, fraud, harassment, or deception.
- A serverless deployment is only as private as the Vercel project, the Telegram bot token, and the Redis database. Rotate all three if exposed.

## Verification performed

- `npm run check` — syntax check for every JavaScript entry point and module.
- `npm test` — **73 tests pass**, including:
  - secret comparison, truncation, display-name sanitization, and access policy;
  - Gemini retry, bounded context, JSON mode, and JSON parsing;
  - persona style, memory/summary injection, and no-placeholder checks;
  - memory normalization, merge, extraction, and selective triggering;
  - session isolation, reset, clear-memory, dedupe, rate limit, and lock;
  - command parsing, inline callbacks, and confirmation flow;
  - guard detection and deflection;
  - webhook integration with mocked Telegram and Gemini, including two rapid messages and a self-disclosure reply.
- Static review of all outbound `fetch` calls and environment variable usage.

## Reporting

If you find a vulnerability, do not open a public issue with exploit details. Contact the repository owner privately and rotate any exposed credentials first.
