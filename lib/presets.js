/**
 * Character presets and small label helpers.
 *
 * Presets only change intensity values. The core personality rules live in
 * `lib/persona.js`, so switching a preset never changes who the character is.
 */

export const PRESETS = {
  extra_clingy: {
    key: "extra_clingy",
    label: "extra clingy",
    emoji: "🥺",
    description: "sangat manja, ekspresif, dan selalu cari perhatian",
    settings: {
      clinginess: 0.95,
      romance: 0.85,
      humor: 0.7,
      emoji: 0.9,
      replyLength: "medium"
    }
  },
  sweet: {
    key: "sweet",
    label: "sweet girlfriend",
    emoji: "🍬",
    description: "manis, romantis, perhatian, tapi lebih tenang",
    settings: {
      clinginess: 0.7,
      romance: 0.8,
      humor: 0.5,
      emoji: 0.6,
      replyLength: "auto"
    }
  },
  playful: {
    key: "playful",
    label: "playful girlfriend",
    emoji: "🎮",
    description: "ceria, jahil, suka bercanda, dan suka menggoda",
    settings: {
      clinginess: 0.6,
      romance: 0.55,
      humor: 0.95,
      emoji: 0.8,
      replyLength: "auto"
    }
  }
};

export const PRESET_KEYS = Object.keys(PRESETS);

export function isPreset(key) {
  return typeof key === "string" && Object.hasOwn(PRESETS, key);
}

export function getPreset(key) {
  return isPreset(key) ? PRESETS[key] : PRESETS.sweet;
}

export function applyPreset(settings, key) {
  const preset = getPreset(key);
  return {
    ...settings,
    preset: preset.key,
    ...preset.settings
  };
}

export function presetLabel(key) {
  return getPreset(key).label;
}

export function levelLabel(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "sedang";
  if (number >= 0.85) return "tinggi banget";
  if (number >= 0.65) return "tinggi";
  if (number >= 0.4) return "sedang";
  return "rendah";
}

export function replyLengthLabel(value) {
  switch (value) {
    case "short":
      return "pendek";
    case "medium":
      return "sedang";
    case "long":
      return "panjang";
    default:
      return "ngikutin kamu";
  }
}

export function languageLabel(value) {
  switch (value) {
    case "en":
      return "english";
    case "mix":
      return "campur indo-english";
    default:
      return "indonesia";
  }
}
