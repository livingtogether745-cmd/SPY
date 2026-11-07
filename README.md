# SPY Telegram Bot

Bot Telegram minimalis untuk deploy 24/7 di Vercel. Memakai **webhook**, bukan long-polling, jadi tidak butuh laptop atau VPS yang selalu menyala.

## Status audit

Repo awal (`livingtogether745-cmd/SPY`) **kosong**: 0 commit dan 0 file. Karena itu tidak ada kode lama yang bisa diaudit. Proyek ini dibangun dari nol dengan prinsip:

- Tanpa dependency npm (lebih kecil, lebih mudah diaudit).
- Tanpa analytics, tracking, iklan, atau script pihak ketiga.
- Tanpa UI/HTML yang tidak perlu.
- Tanpa hardcoded API key atau token.
- Hanya dua host keluar: `api.telegram.org` dan `generativelanguage.googleapis.com`.

Kode sudah lolos `npm run check` (syntax) dan `npm test` (unit test lokal). Integrasi Gemini dan Telegram juga sudah diverifikasi live: API key valid, model membalas dengan benar, webhook terdaftar, dan pesan uji berhasil sampai kembali ke chat Telegram.

Catatan model: Google tidak menyediakan ID `gemini-3.1-flash` (tanpa suffix). Model Flash 3.1 yang benar-benar ada adalah `gemini-3.1-flash-lite`. Saat audit, model itu terukur ~44 detik untuk prompt pendek, sedangkan `gemini-3.5-flash` ~3,5 detik. Produksi saat ini memakai `gemini-3.5-flash` lewat `GEMINI_MODEL` di Vercel. Kalau mau kembali ke 3.1, cukup ganti env var-nya.

## Arsitektur

```
Telegram  --webhook-->  Vercel Function  --HTTPS-->  Gemini API
                              |
                              +---> Telegram sendMessage
```

- `api/webhook.js` — menerima update Telegram, validasi secret, allowlist owner, panggil Gemini, kirim balasan.
- `api/health.js` — health check.
- `lib/gemini.js` — satu-satunya integrasi LLM.
- `lib/telegram.js` — satu-satunya integrasi Telegram.
- `lib/persona.js` — system prompt; bisa dioverride lewat `BOT_PERSONA`.
- `lib/security.js` — env handling, constant-time secret compare, input limit.
- `scripts/set-webhook.mjs` — daftarkan webhook ke Telegram.
- `tests/*.test.mjs` — unit test tanpa network.

## Typing simulation

Bot mengirim aksi native Telegram `typing` segera setelah pesan masuk, lalu me-refresh-nya tiap 4 detik selama Gemini memproses. Setelah balasan siap, pengiriman akhir hanya ditunda kalau generasi selesai lebih cepat dari target:

```
delay = min(2500ms, 350ms + (jumlah karakter balasan × 12ms)) - waktu generasi
```

Kalau generasi sudah lebih lama dari target, delay tambahan = 0. Jadi simulasi tidak memperlambat proses LLM; ia hanya menjaga indikator "typing..." tetap terlihat secara wajar.

## Environment variables

Set semua di **Vercel → Project → Settings → Environment Variables**. Jangan buat file `.env` di repo.

| Variable | Wajib | Keterangan |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Ya | Token dari @BotFather. |
| `TELEGRAM_WEBHOOK_SECRET` | Ya | String acak panjang. Dipakai Telegram untuk membuktikan request asli. |
| `TELEGRAM_OWNER_ID` | Ya setelah setup | ID Telegram kamu. Bot hanya melayani akun ini. |
| `GEMINI_API_KEY` | Ya | API key dari Google AI Studio. |
| `GEMINI_MODEL` | Tidak | Default `gemini-3.1-flash-lite`. |
| `BOT_PERSONA` | Tidak | Override system prompt default. |

Generate webhook secret:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Deploy ke Vercel

1. **Rotate API key.** Key yang pernah dikirim di chat harus dianggap bocor. Buat key baru di <https://aistudio.google.com/app/apikey>, lalu hapus key lama.
2. Buat bot baru di @BotFather (`/newbot`), simpan token.
3. Ambil Telegram ID kamu lewat @userinfobot.
4. Push folder ini ke repo GitHub `livingtogether745-cmd/SPY`.
5. Buka <https://vercel.com/new>, import repo tersebut.
6. Tambahkan environment variables di atas. Untuk `GEMINI_MODEL`, isi `gemini-3.1-flash-lite`.
7. Deploy. Tunggu sampai dapat URL `https://<project>.vercel.app`.
8. Daftarkan webhook dari komputer lokal (PowerShell):

```powershell
$env:TELEGRAM_BOT_TOKEN="token_dari_botfather"
$env:TELEGRAM_WEBHOOK_SECRET="secret_yang_sama_dengan_di_vercel"
node scripts/set-webhook.mjs https://<project>.vercel.app
```

Atau pakai `PUBLIC_BASE_URL`:

```powershell
$env:PUBLIC_BASE_URL="https://<project>.vercel.app"
node scripts/set-webhook.mjs
```

9. Buka chat bot, kirim `/start`, lalu `/id`. Kalau `TELEGRAM_OWNER_ID` belum diisi, bot hanya membalas `/start` dan `/id`.
10. Isi `TELEGRAM_OWNER_ID` dengan ID dari langkah 9, lalu redeploy.
11. Kirim pesan biasa. Bot akan membalas lewat Gemini.

## Cara kerja 24/7 tanpa laptop

Vercel Function hanya berjalan saat ada request. Telegram mengirim request ke webhook setiap ada pesan, jadi tidak perlu proses yang menyala terus. Ini yang membuat bot tetap aktif tanpa laptop dan tanpa VPS.

Konsekuensi:

- **Tidak ada memory antar-pesan.** Setiap pesan diproses terpisah. Kalau butuh ingatan percakapan, tambahkan database seperti Upstash Redis atau Vercel KV.
- **Cold start** bisa menambah 1-2 detik pada pesan pertama setelah lama sepi.
- **Free tier** punya batas jumlah request dan durasi. Untuk pemakaian pribadi biasanya cukup.
- **Gemini free tier** punya rate limit sendiri.

## Troubleshooting

| Gejala | Penyebab umum | Solusi |
|---|---|---|
| `401 invalid_webhook_secret` | Secret di Telegram dan Vercel beda | Jalankan ulang `set-webhook` dengan secret yang sama. |
| `404` dari Gemini | Nama model tidak tersedia | Coba `GEMINI_MODEL=gemini-3.5-flash` atau cek daftar model di AI Studio. |
| `403` / `401` dari Gemini | API key salah, expired, atau bukan API key | Buat key baru di AI Studio. |
| `429` | Kuota/rate limit | Tunggu atau ganti key/tier. |
| `503` dari Gemini | Model sedang kelebihan beban (high demand) | Bot otomatis mencoba ulang 2x dengan backoff. Kalau terus berulang, ganti `GEMINI_MODEL` ke `gemini-3.5-flash`. |
| Bot diam saja | `TELEGRAM_OWNER_ID` bukan akun kamu, atau webhook belum diset | Cek `/id`, cek `getWebhookInfo`, cek Vercel logs. |
| `setWebhook` gagal | URL bukan HTTPS atau belum bisa diakses | Pastikan deploy sukses dan URL `https://.../api/health` mengembalikan `{"ok":true}`. |

## Keamanan

Baca [`SECURITY.md`](./SECURITY.md) untuk threat model dan checklist audit.

Yang **tidak** dilakukan kode ini:

- Tidak mengirim data ke server lain selain Telegram dan Gemini.
- Tidak menyimpan pesan ke database.
- Tidak mencatat isi pesan ke log.
- Tidak memakai token/API key di URL.
- Tidak memakai `eval`, obfuscation, atau dependency pihak ketiga.
- Tidak mengekspos endpoint setup yang bisa dipakai orang lain.
