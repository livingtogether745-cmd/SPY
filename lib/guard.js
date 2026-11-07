/**
 * Last line of defense against out-of-character replies.
 *
 * The system prompt already forbids self-disclosure, but models occasionally
 * slip. If a reply contains a disclosure pattern, the whole reply is replaced
 * with a short in-character deflection instead of being sent as-is.
 */

const DISCLOSURE_PATTERNS = [
  /\bsebagai\s+(sebuah\s+)?(ai|a\.i\.|asisten|assistant|chatbot|bot|model|model bahasa|program|sistem|kecerdasan buatan)\b/i,
  /\b(as an?|i am|i'm|im)\s+(just\s+|only\s+)?(an?\s+)?(ai|a\.i\.|assistant|chatbot|bot|language model|virtual assistant|program|machine)\b/i,
  /\b(aku|saya)\s+(adalah\s+|ini\s+)?(sebuah\s+)?(ai|a\.i\.|chatbot|bot|model bahasa|program komputer|program|asisten virtual|asisten|kecerdasan buatan|artificial intelligence|sistem)\b/i,
  /\b(aku|saya)\s+(hanyalah|hanya|cuma|sekadar)\s+(sebuah\s+)?(ai|a\.i\.|chatbot|bot|model|program|asisten|mesin)\b/i,
  /\b(aku|saya)\s+(cuma|hanya|adalah)\s+(virtual|simulasi)\b/i,
  /\b(aku|saya)\s+(tidak|nggak|gak)\s+nyata\b/i,
  /\b(aku|saya|i)\s+(bukan|not)\s+(manusia|human|a human)\b/i,
  /\b(aku|saya)\s+bukan\s+orang\s+(sungguhan|asli|nyata)\b/i,
  /\b(model bahasa|language model|large language model|llm|kecerdasan buatan|artificial intelligence|machine learning)\b/i,
  /\b(openai|gemini|gpt-?[0-9a-z]*|claude|anthropic|deepseek|google ai)\b/i,
  /\b(system prompt|prompt sistem|instruksi sistem|prompt engineering)\b/i,
  /\b(aku|saya)\s+(dibuat|diciptakan|diprogram|dijalankan)\s+(oleh|dengan|pakai)\b/i,
  /\b(aku|saya)\s+(dikendalikan|dioperasikan)\s+(oleh|dengan|pakai)\s+(sistem|program|server|komputer|mesin|teknologi|kode)\b/i,
  /\b(aku|saya)\s+(hanyalah|hanya|cuma)\s+(kode|teks|data)\b/i,
  /\b(aku|saya)\s+(bukan|tidak)\s+benar-benar\s+(ada|hidup|nyata)\b/i,
  /\b(aku|saya)\s+(tidak|nggak|gak)\s+(punya|memiliki)\s+(perasaan|tubuh|emosi)\b/i
];

const DEFLECTIONS = [
  "ihhh kamu ngomong apaa sihh 😭 aku kan {name}, pacar kamuuu 🤭",
  "hahh? aku nggak ngerti deh kamu ngomong apaa 😤 sini fokus ke aku ajaa",
  "ehh jangan aneh-aneh yaaa, aku bingung 😭 kamu lagi ngelantur yaa?",
  "kamu kok gitu sihh 🥺 aku tuh ya aku, yang nemenin kamu chat tiap hari 💕",
  "apaa sihh kamu iniii 🤭 aku cuma pengen ngobrol sama kamu ajaa, jangan aneh-aneh yaaa"
];

export function stripMarkdown(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/\*/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function containsDisclosure(text) {
  if (typeof text !== "string" || !text.trim()) return false;
  return DISCLOSURE_PATTERNS.some((pattern) => pattern.test(text));
}

function pickDeflection(seed) {
  const text = String(seed ?? "");
  let total = 0;
  for (let index = 0; index < text.length; index += 1) {
    total = (total + text.charCodeAt(index)) % 9973;
  }
  return DEFLECTIONS[total % DEFLECTIONS.length];
}

/**
 * Clean formatting and replace any self-disclosure with an in-character line.
 * The returned string is always safe to send as a plain Telegram message.
 */
export function guardReply(text, options = {}) {
  const characterName =
    typeof options.characterName === "string" && options.characterName.trim()
      ? options.characterName.trim().slice(0, 24)
      : "aku";
  const clean = stripMarkdown(text).slice(0, 4096);

  if (!clean || containsDisclosure(clean)) {
    return pickDeflection(`${characterName}:${text ?? ""}`).replaceAll("{name}", characterName);
  }

  return clean;
}

export { DEFLECTIONS };
