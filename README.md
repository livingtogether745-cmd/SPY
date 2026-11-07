# SPY Telegram Bot — Virtual Girlfriend

Bot Telegram serverless untuk percakapan roleplay dengan karakter pacar virtual. Memakai **webhook Vercel**, **Gemini**, dan **Redis REST** untuk memori per pengguna. Tanpa dependency npm, tanpa frontend, dan tanpa analytics.

Karakter default bernama **Ayu**: clingy, manja, ceria, romantis, perhatian, playful, dan sedikit jahil. Gaya chatting mengikuti perempuan Gen Z Indonesia: huruf kecil, bahasa santai, pemanjangan huruf natural, emoji bervariasi, dan panjang balasan yang menyesuaikan pesan pengguna.

## Status verifikasi

- `npm run check` — syntax check seluruh entry point dan modul.
- `npm test` — **73 test lulus**, termasuk unit test dan integration test webhook dengan Telegram + Gemini yang di-mock.
- Integration test mencakup: `/start`, pesan biasa, ekstraksi memori, `/memory`, `/clearmemory` + callback, guard anti-disclosure, dua pesan beruntun, callback preset, dan penolakan user di luar allowlist.
- Upgrade ini **belum di-commit, di-push, atau di-deploy**. Deploy dilakukan hanya setelah instruksi eksplisit.
- Catatan verifikasi live: panggilan Gemini asli untuk upgrade ini belum bisa dilakukan dari mesin lokal karena `vercel env pull` mengembalikan nilai `[SENSITIVE]` dan tidak ada `GEMINI_API_KEY` di `.env.local`. Integration test memakai mock. Setelah deploy, lakukan smoke test nyata ke bot.

## Arsitektur

```
Telegram
   |
   | webhook POST /api/webhook
   v
Vercel Function
   |-- validasi secret + dedupe update_id
   |-- lock per user + rate limit
   |-- load session (Redis / in-memory)
   |-- command router / callback router
   |-- Gemini generateContent
   |     |-- system prompt + memori + ringkasan + history
   |     `-- ekstraksi memori & ringkasan (paralel)
   |-- guard anti-disclosure
   |-- simpan session
   `-- sendMessage / editMessageText / sendChatAction
```

Host keluar hanya:

1. `https://api.telegram.org`
2. `https://generativelanguage.googleapis.com`
3. URL Redis REST yang kamu konfigurasi sendiri (Upstash / Vercel KV)

## Modul

| File | Fungsi |
|---|---|
| `api/webhook.js` | Router update Telegram, validasi secret, dedupe, lock, rate limit, typing, simpan session. |
| `api/health.js` | Health check + status storage (`redis` / `memory`). |
| `lib/persona.js` | System prompt karakter, preset, bahasa, memori, ringkasan, aturan anti-robot. |
| `lib/presets.js` | Definisi EXTRA CLINGY, SWEET GIRLFRIEND, PLAYFUL GIRLFRIEND dan label. |
| `lib/memory.js` | Normalisasi, merge, format, dan ekstraksi memori jangka panjang. |
| `lib/session.js` | Session per user, history, summary, reset, dedupe, rate limit, lock. |
| `lib/commands.js` | Semua command dan inline keyboard. |
| `lib/guard.js` | Deteksi dan penggantian balasan yang membocorkan identitas non-human. |
| `lib/gemini.js` | Client Gemini dengan retry terbatas, history, JSON mode, context bounded. |
| `lib/telegram.js` | Client Telegram: send, edit, callback answer, typing indicator. |
| `lib/store.js` | Redis REST + fallback in-memory, TTL, `setIfAbsent`, `incrWithTtl`. |
| `lib/security.js` | Env, constant-time secret compare, truncate, sanitasi nama, access policy. |
| `scripts/set-webhook.mjs` | Daftarkan webhook dengan update `message` + `callback_query`. |
| `tests/*.test.mjs` | Unit + integration test tanpa network nyata. |

## Command

| Command | Fungsi |
|---|---|
| `/start` | Sapaan karakter + tombol preset. |
| `/help` | Daftar command. |
| `/reset` | Hapus konteks obrolan aktif, memori tetap disimpan. |
| `/memory` | Tampilkan memori jangka panjang + jumlah percakapan aktif. |
| `/clearmemory` | Minta konfirmasi, lalu hapus memori jangka panjang saja. |
| `/persona` | Tampilkan pengaturan + inline keyboard. |
| `/about` | Info karakter dan privasi. |
| `/setname <nama>` | Ganti nama karakter untuk user tersebut. |
| `/callme <panggilan>` | Ganti panggilan user. |
| `/language id\|en\|mix` | Ganti bahasa balasan. |
| `/preset extra_clingy\|sweet\|playful` | Ganti preset karakter. |
| `/mode` | Menjelaskan bahwa hanya ada mode pacar (tidak ada prompt builder). |
| `/id` | Menampilkan Telegram ID, berguna saat setup. |

## Preset

| Preset | Karakter |
|---|---|
| `extra_clingy` | Sangat manja, ekspresif, sering cari perhatian, emoji tinggi. |
| `sweet` | Manis, romantis, perhatian, lebih tenang. |
| `playful` | Ceria, jahil, suka bercanda, humor tinggi. |

Preset hanya mengubah intensitas (`clinginess`, `romance`, `humor`, `emoji`, `replyLength`). Kepribadian inti dan aturan keamanan tetap sama, jadi karakter tidak berubah drastis di tengah percakapan. User juga bisa menyesuaikan tiap intensitas lewat `/persona`.

## Sistem memori

### Short-term memory

- Disimpan per user di `spy:session:<userId>`.
- Maksimal 40 pesan tersimpan.
- Maksimal 16 pesan terakhir dikirim ke Gemini, dengan batas 12.000 karakter.
- Jika percakapan panjang, ringkasan dibuat otomatis dan history dipangkas.

### Long-term memory

- Hanya fakta yang disebut user secara eksplisit: panggilan, umur, lokasi, pekerjaan/sekolah, kesukaan, ketidaksukaan, hobi, hal penting, dan catatan.
- Ekstraksi dilakukan setiap 4 pesan user, atau langsung saat pesan terlihat mengandung info personal.
- Ekstraksi berjalan **paralel** dengan generasi balasan, jadi tidak menambah satu giliran LLM serial.
- Setiap daftar dibatasi 12 item (catatan 8 item), masing-masing maksimal 120 karakter.
- AI dilarang mengarang ingatan. Jika memori kosong, prompt secara eksplisit mengatakan belum ada info.

### Isolasi dan reset

- Setiap user punya session, history, memori, dan pengaturan sendiri.
- `/reset` hanya menghapus history + summary user tersebut.
- `/clearmemory` hanya menghapus memori jangka panjang user tersebut.
- Tidak ada command admin yang bisa menghapus data user lain.

## Gaya percakapan dan guard

System prompt mengatur:

- huruf kecil, bahasa santai, pemanjangan huruf natural;
- emoji bervariasi, tidak berlebihan;
- panjang balasan menyesuaikan pesan user;
- tidak membuka dengan template yang sama terus;
- tidak selalu memakai "sayang" atau "kangen";
- tidak mengakhiri setiap pesan dengan pertanyaan;
- menanggapi isi cerita, bukan sekadar menempel kalimat manis;
- memvalidasi emosi sebelum memberi solusi;
- tidak manipulatif dan tidak mengisolasi user dari kehidupan nyata;
- tidak menghasilkan konten seksual eksplisit.

`lib/guard.js` adalah lapisan terakhir: jika balasan mengandung pola seperti "sebagai AI", "aku bot", "language model", "system prompt", atau nama provider, seluruh balasan diganti dengan deflection singkat yang tetap in-character. Guard juga membersihkan markdown yang tidak cocok untuk pesan Telegram plain text.

## Environment variables

Set semua di **Vercel → Project → Settings → Environment Variables**. Jangan commit nilai asli.

| Variable | Wajib | Keterangan |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Ya | Token dari @BotFather. |
| `TELEGRAM_WEBHOOK_SECRET` | Ya | String acak panjang untuk validasi webhook. |
| `TELEGRAM_ALLOWED_IDS` | Disarankan | Daftar ID dipisah koma. Jika diisi, hanya ID ini yang dilayani. |
| `TELEGRAM_PUBLIC` | Tidak | `true` untuk membuka bot ke semua orang. Tetap ada rate limit. |
| `TELEGRAM_OWNER_ID` | Tidak | Mode lama: hanya owner. Dipakai jika `TELEGRAM_ALLOWED_IDS` kosong. |
| `GEMINI_API_KEY` | Ya | API key Google AI Studio. |
| `GEMINI_MODEL` | Tidak | Default kode `gemini-3.1-flash-lite`; produksi disarankan `gemini-3.5-flash`. |
| `CHARACTER_NAME` | Tidak | Nama default karakter. Default `Ayu`. |
| `DEFAULT_PRESET` | Tidak | `extra_clingy`, `sweet`, atau `playful`. Default `sweet`. |
| `BOT_PERSONA` | Tidak | Override system prompt. Placeholder: `{{name}}`, `{{user}}`, `{{memory}}`, `{{summary}}`, `{{now}}`. |
| `UPSTASH_REDIS_REST_URL` | Ya untuk produksi | URL REST Upstash Redis. |
| `UPSTASH_REDIS_REST_TOKEN` | Ya untuk produksi | Token REST Upstash Redis. |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Alternatif | Nama env Vercel KV. |
| `PUBLIC_BASE_URL` | Tidak | Dipakai `scripts/set-webhook.mjs` jika URL tidak dikirim sebagai argumen. |

Jika Redis tidak dikonfigurasi, bot memakai fallback in-memory. Bot tetap bisa membalas, tetapi memori tidak konsisten antar instance serverless dan hilang saat function restart.

## Deploy

1. Rotate token/API key yang pernah terekspos.
2. Buat bot di @BotFather dan simpan token.
3. Buat database Upstash Redis (atau Vercel KV) dan salin URL + token REST.
4. Import repo ke Vercel.
5. Isi environment variables di atas.
6. Deploy sampai dapat URL `https://<project>.vercel.app`.
7. Daftarkan webhook:

```powershell
$env:TELEGRAM_BOT_TOKEN="token_dari_botfather"
$env:TELEGRAM_WEBHOOK_SECRET="secret_yang_sama_dengan_di_vercel"
node scripts/set-webhook.mjs https://<project>.vercel.app
```

8. Cek `https://<project>.vercel.app/api/health`. Response `storage: "redis"` berarti memori persisten aktif.
9. Buka chat bot dan kirim `/start`.

Untuk mode publik, set `TELEGRAM_PUBLIC=true`. Untuk mode terbatas, isi `TELEGRAM_ALLOWED_IDS`. Untuk setup awal, kosongkan keduanya dan gunakan `/id`.

## Testing

```powershell
npm run check
npm test
```

Test tidak memanggil Telegram atau Gemini asli. Integration test memakai `fetch` mock dan in-memory store, jadi aman dijalankan tanpa kredensial.

Contoh cakupan:

- retry Gemini 503/timeout dan non-retryable 404;
- bounded context dan JSON mode;
- guard anti-disclosure;
- normalisasi/merge/ekstraksi memori;
- session isolation, reset, clear memory;
- dedupe update, rate limit, per-user lock;
- command, callback, dan konfirmasi `/clearmemory`;
- webhook end-to-end dengan Telegram + Gemini mock.

## Typing simulation

Bot mengirim aksi native Telegram `typing` segera setelah pesan masuk, lalu me-refresh tiap 4 detik selama Gemini memproses. Pengiriman akhir hanya ditunda jika generasi selesai lebih cepat dari target:

```
delay = min(2500ms, 350ms + (jumlah karakter balasan × 12ms)) - waktu generasi
```

Jika generasi sudah lebih lama dari target, delay tambahan = 0. Simulasi tidak memperlambat LLM; ia hanya menjaga indikator "typing..." terlihat wajar.

## Troubleshooting

| Gejala | Penyebab umum | Solusi |
|---|---|---|
| `401 invalid_webhook_secret` | Secret Telegram dan Vercel beda | Jalankan ulang `set-webhook` dengan secret yang sama. |
| Bot diam | User tidak ada di `TELEGRAM_ALLOWED_IDS`, atau `TELEGRAM_PUBLIC` bukan `true` | Cek access policy dan `/id`. |
| `/memory` selalu kosong | Redis belum dikonfigurasi, atau user belum pernah cerita info personal | Cek `/api/health` (`storage`), isi Redis env, coba cerita nama/kesukaan. |
| Memori hilang setelah deploy | Masih memakai fallback in-memory | Konfigurasi `UPSTASH_REDIS_REST_URL` + token. |
| `404` dari Gemini | Nama model tidak tersedia | Coba `GEMINI_MODEL=gemini-3.5-flash`. |
| `503` dari Gemini | Model kelebihan beban | Bot retry 2x dengan backoff. Jika terus berulang, ganti model. |
| Balasan lambat | Model Gemini lambat atau retry | Cek Vercel logs. `gemini-3.1-flash-lite` pernah terukur ~44 detik; `gemini-3.5-flash` ~3,5 detik. |
| `setWebhook` gagal | URL bukan HTTPS atau belum bisa diakses | Pastikan `/api/health` mengembalikan `{"ok":true}`. |

## Keterbatasan yang masih ada

- **Tidak ada mode prompt builder.** Project ini tidak pernah punya fitur tersebut, jadi `/mode prompt` tidak dibuat. `/mode` hanya menjelaskan bahwa mode pacar adalah satu-satunya mode.
- **Memori produksi butuh Redis.** Tanpa Redis, fallback in-memory tidak cocok untuk banyak pengguna.
- **Tidak ada dashboard admin.** Pengaturan dilakukan lewat command dan inline keyboard.
- **Ekstraksi memori memakai LLM.** Jika Gemini gagal saat ekstraksi, balasan tetap terkirim tetapi memori giliran itu tidak tersimpan.
- **Rate limit sederhana.** 20 pesan per 60 detik per user. Bukan proteksi abuse tingkat lanjut.
- **Tidak ada moderasi konten berlapis.** Selain aturan prompt dan guard identitas, tidak ada classifier konten terpisah.
- **Karakter adalah roleplay.** Jangan gunakan untuk impersonasi, penipuan, atau manipulasi orang lain.

## Keamanan

Baca [`SECURITY.md`](./SECURITY.md) untuk threat model, penanganan secret, dan checklist audit.

Yang tidak dilakukan kode ini:

- tidak mengirim data ke host lain selain Telegram, Gemini, dan Redis milikmu;
- tidak mencatat isi pesan ke log;
- tidak memakai token/API key di URL;
- tidak memakai `eval`, obfuscation, atau dependency pihak ketiga;
- tidak mengekspos endpoint setup yang bisa dipakai orang lain.
