import test from "node:test";
import assert from "node:assert/strict";
import { defaultSession } from "../lib/session.js";
import {
  clearMemoryKeyboard,
  handleCallback,
  handleCommand,
  handlePendingClear,
  parseCommand,
  pendingClearMemoryActive,
  personaKeyboard,
  presetKeyboard
} from "../lib/commands.js";

test("parseCommand handles plain commands, bot suffixes, and arguments", () => {
  assert.deepEqual(parseCommand("/start"), { name: "start", args: "" });
  assert.deepEqual(parseCommand("/start@naiba23_bot"), { name: "start", args: "" });
  assert.deepEqual(parseCommand("/language en"), { name: "language", args: "en" });
  assert.deepEqual(parseCommand("/setname Naya"), { name: "setname", args: "Naya" });
  assert.equal(parseCommand("halo"), null);
  assert.equal(parseCommand(""), null);
});

test("/help lists the user-facing commands", () => {
  const session = defaultSession();
  const result = handleCommand({ command: "help", session });
  assert.equal(result.handled, true);
  for (const command of ["/start", "/reset", "/memory", "/clearmemory", "/persona", "/about"]) {
    assert.match(result.text, new RegExp(command.replace("/", "\\/")));
  }
});

test("/start greets the user with preset buttons", () => {
  const session = defaultSession();
  session.settings.characterName = "Naya";
  session.settings.userName = "Raka";

  const result = handleCommand({ command: "start", session });
  assert.match(result.text, /Naya/);
  assert.match(result.text, /Raka/);
  assert.ok(result.replyMarkup.inline_keyboard.length >= 1);
});

test("/reset clears context but keeps memory", () => {
  const session = defaultSession();
  session.history.push({ role: "user", text: "halo" });
  session.summary = "ringkasan";
  session.memory.profile.nickname = "Raka";

  const result = handleCommand({ command: "reset", session });
  assert.equal(result.changed, true);
  assert.equal(session.history.length, 0);
  assert.equal(session.summary, "");
  assert.equal(session.memory.profile.nickname, "Raka");
});

test("/memory shows known facts and hides an empty memory", () => {
  const session = defaultSession();
  const empty = handleCommand({ command: "memory", session });
  assert.match(empty.text, /belum cerita banyak/);

  session.memory.profile.nickname = "Raka";
  session.memory.likes = ["kopi"];
  const filled = handleCommand({ command: "memory", session });
  assert.match(filled.text, /Raka/);
  assert.match(filled.text, /kopi/);
});

test("/clearmemory asks for confirmation and sets a short-lived pending flag", () => {
  const session = defaultSession();
  const result = handleCommand({ command: "clearmemory", session });

  assert.equal(result.changed, true);
  assert.equal(pendingClearMemoryActive(session), true);
  assert.equal(result.replyMarkup.inline_keyboard[0][0].callback_data, "clear:yes");
});

test("/persona and /preset update settings consistently", () => {
  const session = defaultSession();

  const persona = handleCommand({ command: "persona", session });
  assert.match(persona.text, /pengaturan aku sekarang/);
  assert.ok(persona.replyMarkup.inline_keyboard.length > 1);

  const preset = handleCommand({ command: "preset", args: "playful", session });
  assert.equal(preset.changed, true);
  assert.equal(session.settings.preset, "playful");
  assert.ok(session.settings.humor > 0.9);

  const invalid = handleCommand({ command: "preset", args: "unknown", session });
  assert.equal(invalid.changed, false);
  assert.match(invalid.text, /belum ada/);
});

test("/setname, /callme, /language, and /id are sanitized", () => {
  const session = defaultSession();

  const name = handleCommand({ command: "setname", args: "  Naya\u0000  ", session });
  assert.equal(name.changed, true);
  assert.equal(session.settings.characterName, "Naya");

  const callme = handleCommand({ command: "callme", args: "Raka", session });
  assert.equal(callme.changed, true);
  assert.equal(session.settings.userName, "Raka");

  const language = handleCommand({ command: "language", args: "mix", session });
  assert.equal(language.changed, true);
  assert.equal(session.settings.language, "mix");

  const id = handleCommand({ command: "id", session, userId: "8802970087" });
  assert.match(id.text, /8802970087/);
});

test("unknown commands get a gentle in-character fallback", () => {
  const session = defaultSession();
  const result = handleCommand({ command: "nonsense", session });
  assert.equal(result.handled, true);
  assert.match(result.text, /perintah itu belum ada/);
});

test("inline keyboard callbacks update settings and clear memory", () => {
  const session = defaultSession();

  const preset = handleCallback({ data: "p:preset:extra_clingy", session });
  assert.equal(preset.changed, true);
  assert.equal(session.settings.preset, "extra_clingy");

  const emoji = handleCallback({ data: "p:emoji:high", session });
  assert.equal(emoji.changed, true);
  assert.equal(session.settings.emoji, 0.9);

  const length = handleCallback({ data: "p:length:short", session });
  assert.equal(length.changed, true);
  assert.equal(session.settings.replyLength, "short");

  const lang = handleCallback({ data: "p:lang:en", session });
  assert.equal(lang.changed, true);
  assert.equal(session.settings.language, "en");

  session.memory.profile.nickname = "Raka";
  const clear = handleCallback({ data: "clear:yes", session });
  assert.equal(clear.changed, true);
  assert.equal(session.memory.profile.nickname, "");
});

test("pending clear-memory confirmation accepts yes/no and ignores other text", () => {
  const session = defaultSession();
  session.memory.profile.nickname = "Raka";
  handleCommand({ command: "clearmemory", session });

  const other = handlePendingClear(session, "lagi ngapain?");
  assert.equal(other.text, null);
  assert.equal(pendingClearMemoryActive(session), false);
  assert.equal(session.memory.profile.nickname, "Raka");

  handleCommand({ command: "clearmemory", session });
  const yes = handlePendingClear(session, "iyaa hapus");
  assert.match(yes.text, /udah aku hapus/);
  assert.equal(session.memory.profile.nickname, "");

  session.memory.profile.nickname = "Raka";
  handleCommand({ command: "clearmemory", session });
  const no = handlePendingClear(session, "engga");
  assert.match(no.text, /aman/);
  assert.equal(session.memory.profile.nickname, "Raka");
});

test("all callback_data values fit Telegram's 64-byte limit", () => {
  const session = defaultSession();
  const keyboards = [
    presetKeyboard(),
    personaKeyboard(session),
    clearMemoryKeyboard()
  ];

  for (const keyboard of keyboards) {
    for (const row of keyboard.inline_keyboard) {
      for (const button of row) {
        assert.ok(Buffer.byteLength(button.callback_data, "utf8") <= 64, button.callback_data);
      }
    }
  }
});
