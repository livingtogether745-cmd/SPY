import { isPersistent } from "../lib/store.js";

export default function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }
  res.status(200).json({
    ok: true,
    service: "spy-telegram-bot",
    storage: isPersistent() ? "redis" : "memory"
  });
}
