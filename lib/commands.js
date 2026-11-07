/**
 * Telegram command and inline-keyboard handlers.
 *
 * These functions are pure: they mutate the session object and return text +
 * optional reply markup. The webhook owns all network calls.
 */

import {
  applyPreset,
  getPreset,
  isPreset,
  languageLabel,
  levelLabel,
  presetLabel,
  replyLengthLabel,
  PRESET_KEYS
} from "./presets.js";
import {
  PENDING_TTL_MS,
  clearLongTermMemory,
  clearPending,
  resetConversation,
  setClearMemoryPending
} from "./session.js";
import { formatMemoryForPrompt, hasMemory } from "./memory.js";
import { sanitizeDisplayName } from "./security.js";

const COMMAND_PATTERN = /^\/([a-zA-Z0-9_]+)(?:@[a-zA-Z0-9_]+)?(?:\s+([\s\S]*))?$/;

export function parseCommand(text) {
  if (typeof text !== "string") return null;
  const match = COMMAND_PATTERN.exec(text.trim());
  if (!match) return null;
  return { name: match[1].toLowerCase(), args: (match[2] ?? "").trim() };
}

export function isAffirmative(text) {
  return /^(ya+|iya+|yakin|hapus|gas|boleh|ok|oke|lanjut|sip)\b/i.test(String(text ?? "").trim());
}

export function isNegative(text) {
  return /^(engga|ngga|nggak|gak|tidak|jangan|batal|no|nope)\b/i.test(String(text ?? "").trim());
}

export function pendingClearMemoryActive(session) {
  const at = Number(session?.pending?.clearMemoryAt);
  return Number.isFinite(at) && at > 0 && Date.now() - at <= PENDING_TTL_MS;
}

function optionButton(label, data, active = false) {
  return { text: `${active ? "✓ " : ""}${label}`, callback_data: data };
}

function bucket(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "normal";
  if (number < 0.45) return "low";
  if (number < 0.75) return "normal";
  return "high";
}

export function presetKeyboard() {
  return {
    inline_keyboard: [
      [
        optionButton("🥺 extra clingy", "p:preset:extra_clingy"),
        optionButton("🍬 sweet", "p:preset:sweet"),
        optionButton("🎮 playful", "p:preset:playful")
      ],
      [optionButton("🎀 atur persona", "p:persona")]
    ]
  };
}

export function personaKeyboard(session) {
  const settings = session.settings;
  return {
    inline_keyboard: [
      [
        optionButton("🥺 extra clingy", "p:preset:extra_clingy", settings.preset === "extra_clingy"),
        optionButton("🍬 sweet", "p:preset:sweet", settings.preset === "sweet"),
        optionButton("🎮 playful", "p:preset:playful", settings.preset === "playful")
      ],
      [
        optionButton("emoji rendah", "p:emoji:low", bucket(settings.emoji) === "low"),
        optionButton("normal", "p:emoji:normal", bucket(settings.emoji) === "normal"),
        optionButton("tinggi", "p:emoji:high", bucket(settings.emoji) === "high")
      ],
      [
        optionButton("romantis rendah", "p:romance:low", bucket(settings.romance) === "low"),
        optionButton("normal", "p:romance:normal", bucket(settings.romance) === "normal"),
        optionButton("tinggi", "p:romance:high", bucket(settings.romance) === "high")
      ],
      [
        optionButton("clingy rendah", "p:clingy:low", bucket(settings.clinginess) === "low"),
        optionButton("normal", "p:clingy:normal", bucket(settings.clinginess) === "normal"),
        optionButton("tinggi", "p:clingy:high", bucket(settings.clinginess) === "high")
      ],
      [
        optionButton("pendek", "p:length:short", settings.replyLength === "short"),
        optionButton("auto", "p:length:auto", settings.replyLength === "auto"),
        optionButton("panjang", "p:length:long", settings.replyLength === "long")
      ],
      [
        optionButton("indo", "p:lang:id", settings.language === "id"),
        optionButton("english", "p:lang:en", settings.language === "en"),
        optionButton("mix", "p:lang:mix", settings.language === "mix")
      ],
      [optionButton("🧹 hapus memori", "p:clear"), optionButton("📖 bantuan", "p:help")]
    ]
  };
}

export function clearMemoryKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "iyaa, hapus 🥺", callback_data: "clear:yes" },
        { text: "enggaa, jangan", callback_data: "clear:no" }
      ]
    ]
  };
}

export function startText(session) {
  const settings = session.settings;
  return `haiii ${settings.userName}!! 🥰💕 akhirnya kamu datang jugaaa!!
aku ${settings.characterName}, pacar kamu di sini 🤭

mau mulai dari mana nih? cerita hari kamu, atau pilih mood aku dulu?`;
}

export function helpText() {
  return `ini yang bisa kamu lakuin yaa 💕

/start — sapa aku lagi
/reset — mulai obrolan dari awal
/memory — lihat apa yang aku inget
/clearmemory — hapus memori kamu
/persona — atur karakter aku
/setname <nama> — ganti nama aku
/callme <panggilan> — ganti panggilan kamu
/language id|en|mix — ganti bahasa
/about — tentang aku

kalau mau ngobrol biasa, tinggal ketik aja yaaa 🥰`;
}

export function aboutText(session) {
  return `aku ${session.settings.characterName} 💕 pacar virtual kamu di telegram.

aku di sini buat nemenin kamu ngobrol, dengerin cerita, dan bikin harimu sedikit lebih rame 🥰
obrolan dan memori kamu cuma buat kamu, nggak dicampur sama orang lain.

kalau mau lihat yang bisa kamu lakuin, ketik /help yaa`;
}

export function memoryText(session) {
  const header = `🧠 ini yang aku inget tentang kamu:`;
  if (!hasMemory(session.memory)) {
    return `hmm, sejauh ini kamu belum cerita banyak ke aku 🥺
coba cerita nama panggilan, kesukaan, atau hal yang lagi kamu kerjain. nanti aku inget yaa 💕

💬 obrolan aktif: ${Math.ceil(session.history.length / 2)} percakapan
🎀 preset: ${presetLabel(session.settings.preset)}`;
  }

  return `${header}
${formatMemoryForPrompt(session.memory)}

💬 obrolan aktif: ${Math.ceil(session.history.length / 2)} percakapan
🎀 preset: ${presetLabel(session.settings.preset)}`;
}

export function personaText(session) {
  const settings = session.settings;
  return `🎀 pengaturan aku sekarang

nama aku: ${settings.characterName}
panggilan kamu: ${settings.userName}
preset: ${presetLabel(settings.preset)}
clingy: ${levelLabel(settings.clinginess)}
romantis: ${levelLabel(settings.romance)}
humor: ${levelLabel(settings.humor)}
emoji: ${levelLabel(settings.emoji)}
panjang balasan: ${replyLengthLabel(settings.replyLength)}
bahasa: ${languageLabel(settings.language)}`;
}

export function clearMemoryPrompt() {
  return `yakin mau hapus semua memori kamu? 🥺
kalau iya, aku bakal lupa nama panggilan, kesukaan, dan cerita penting kamu. obrolan aktif tetap aman yaa.`;
}

export function presetListText(session) {
  const lines = PRESET_KEYS.map((key) => {
    const preset = getPreset(key);
    return `${preset.emoji} ${preset.label} — ${preset.description}`;
  });
  return `pilih mood aku yaa 🎀

${lines.join("\n")}

sekarang: ${presetLabel(session.settings.preset)}`;
}

/**
 * Handle a slash command. Returns handled=false only when the text is not a
 * known command, so the caller can treat it as normal chat.
 */
export function handleCommand({ command, args = "", session, userId = "" }) {
  switch (command) {
    case "start":
      return {
        handled: true,
        changed: false,
        text: startText(session),
        replyMarkup: presetKeyboard()
      };

    case "help":
      return { handled: true, changed: false, text: helpText() };

    case "about":
      return { handled: true, changed: false, text: aboutText(session) };

    case "id":
      return {
        handled: true,
        changed: false,
        text: `telegram id kamu: ${userId}`
      };

    case "reset":
      resetConversation(session);
      return {
        handled: true,
        changed: true,
        text: `okeeyy, obrolan kita aku mulai dari awal lagii yaa 🔄
memori kamu tetap aku simpen kok, jadi kamu nggak perlu kenalan ulang 🥰`
      };

    case "memory":
      return { handled: true, changed: false, text: memoryText(session) };

    case "clearmemory":
      setClearMemoryPending(session);
      return {
        handled: true,
        changed: true,
        text: clearMemoryPrompt(),
        replyMarkup: clearMemoryKeyboard()
      };

    case "persona":
    case "menu":
      return {
        handled: true,
        changed: false,
        text: personaText(session),
        replyMarkup: personaKeyboard(session)
      };

    case "preset": {
      const key = args.toLowerCase().replace(/\s+/g, "_");
      if (!key) {
        return {
          handled: true,
          changed: false,
          text: presetListText(session),
          replyMarkup: personaKeyboard(session)
        };
      }
      if (!isPreset(key)) {
        return {
          handled: true,
          changed: false,
          text: `preset itu belum ada yaa 🥺 pilihannya: ${PRESET_KEYS.join(", ")}`
        };
      }
      session.settings = applyPreset(session.settings, key);
      return {
        handled: true,
        changed: true,
        text: `yayy, mulai sekarang aku pakai preset ${presetLabel(key)} yaa ${getPreset(key).emoji}`,
        replyMarkup: personaKeyboard(session)
      };
    }

    case "setname": {
      const name = sanitizeDisplayName(args, 24);
      if (!name) {
        return {
          handled: true,
          changed: false,
          text: "cara pakainya: /setname <nama aku> yaa, maksimal 24 huruf 🥺"
        };
      }
      session.settings.characterName = name;
      return {
        handled: true,
        changed: true,
        text: `okeeyy, mulai sekarang panggil aku ${name} yaa 😚`
      };
    }

    case "callme": {
      const nickname = sanitizeDisplayName(args, 24);
      if (!nickname) {
        return {
          handled: true,
          changed: false,
          text: "cara pakainya: /callme <panggilan kamu> yaa, maksimal 24 huruf 🥺"
        };
      }
      session.settings.userName = nickname;
      return {
        handled: true,
        changed: true,
        text: `okeeyy, aku panggil kamu ${nickname} mulai sekarang 💕`
      };
    }

    case "language": {
      const value = args.toLowerCase();
      if (!["id", "en", "mix"].includes(value)) {
        return {
          handled: true,
          changed: false,
          text: `bahasa sekarang: ${languageLabel(session.settings.language)}
pilih: /language id, /language en, atau /language mix`
        };
      }
      session.settings.language = value;
      return {
        handled: true,
        changed: true,
        text: `sip, sekarang aku ngobrol pakai ${languageLabel(value)} yaa 💕`
      };
    }

    case "mode":
      return {
        handled: true,
        changed: false,
        text: `sekarang aku cuma punya mode pacar yaa 🤭
di project ini nggak ada mode pembuat prompt, jadi aku belum bisa pindah ke mode itu.`
      };

    default:
      return {
        handled: true,
        changed: false,
        text: `perintah itu belum ada yaa 🥺 ketik /help buat lihat yang bisa kamu lakuin`
      };
  }
}

function setLevel(session, field, value) {
  const map = { low: 0.3, normal: 0.6, high: 0.9 };
  if (!Object.hasOwn(map, value)) return false;
  session.settings[field] = map[value];
  return true;
}

/** Handle an inline-keyboard callback. */
export function handleCallback({ data, session }) {
  const parts = String(data ?? "").split(":");
  const prefix = parts[0];
  const action = parts[1];
  const value = parts[2];

  if (prefix === "clear") {
    if (action === "yes") {
      clearLongTermMemory(session);
      return {
        changed: true,
        text: `okeeyy, memori kamu udah aku hapus 🧹
kita mulai kenalan lagi dari awal yaa, cerita apa aja ke aku 💕`
      };
    }
    clearPending(session);
    return {
      changed: true,
      text: "okeeyy, memori kamu aman. aku nggak hapus apa-apa yaa 🤭"
    };
  }

  if (prefix !== "p") {
    return { changed: false, text: "tombol itu udah nggak aktif yaa 🥺" };
  }

  if (action === "persona") {
    return { changed: false, text: personaText(session), replyMarkup: personaKeyboard(session) };
  }

  if (action === "help") {
    return { changed: false, text: helpText() };
  }

  if (action === "preset") {
    if (!isPreset(value)) {
      return { changed: false, text: "preset itu belum ada yaa 🥺" };
    }
    session.settings = applyPreset(session.settings, value);
    return {
      changed: true,
      text: `yayy, mulai sekarang aku pakai preset ${presetLabel(value)} yaa ${getPreset(value).emoji}`,
      replyMarkup: personaKeyboard(session)
    };
  }

  if (action === "emoji" || action === "romance" || action === "clingy") {
    const field = action === "emoji" ? "emoji" : action === "romance" ? "romance" : "clinginess";
    const label = action === "emoji" ? "emoji" : action === "romance" ? "romantis" : "clingy";
    if (!setLevel(session, field, value)) {
      return { changed: false, text: "pilihannya belum ada yaa 🥺" };
    }
    return {
      changed: true,
      text: `sip, ${label} aku sekarang ${levelLabel(session.settings[field])} yaa 💕`,
      replyMarkup: personaKeyboard(session)
    };
  }

  if (action === "length") {
    if (!["short", "auto", "long"].includes(value)) {
      return { changed: false, text: "pilihannya belum ada yaa 🥺" };
    }
    session.settings.replyLength = value;
    return {
      changed: true,
      text: `okeeyy, panjang balasan aku sekarang ${replyLengthLabel(value)} 💕`,
      replyMarkup: personaKeyboard(session)
    };
  }

  if (action === "lang") {
    if (!["id", "en", "mix"].includes(value)) {
      return { changed: false, text: "bahasa itu belum ada yaa 🥺" };
    }
    session.settings.language = value;
    return {
      changed: true,
      text: `sip, sekarang aku ngobrol pakai ${languageLabel(value)} yaa 💕`,
      replyMarkup: personaKeyboard(session)
    };
  }

  if (action === "clear") {
    setClearMemoryPending(session);
    return { changed: true, text: clearMemoryPrompt(), replyMarkup: clearMemoryKeyboard() };
  }

  return { changed: false, text: "tombol itu udah nggak aktif yaa 🥺" };
}

/**
 * If /clearmemory is pending, handle a plain-text yes/no answer. Returns null
 * when no confirmation is pending.
 */
export function handlePendingClear(session, text) {
  if (!pendingClearMemoryActive(session)) return null;

  if (isAffirmative(text)) {
    clearLongTermMemory(session);
    return {
      changed: true,
      text: `okeeyy, memori kamu udah aku hapus 🧹
kita mulai kenalan lagi dari awal yaa, cerita apa aja ke aku 💕`
    };
  }

  if (isNegative(text)) {
    clearPending(session);
    return {
      changed: true,
      text: "okeeyy, memori kamu aman. aku nggak hapus apa-apa yaa 🤭"
    };
  }

  // Not a yes/no answer: cancel the confirmation and let the message through.
  clearPending(session);
  return { changed: true, text: null };
}
