/**
 * Storage abstraction.
 *
 * Production: Upstash Redis REST (also compatible with Vercel KV env names).
 * Local/tests: in-memory Map with TTL support.
 *
 * No npm dependency is required; Upstash speaks plain HTTP.
 */

const memoryStore = new Map();

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

export function isPersistent() {
  return Boolean(getRedisConfig());
}

async function redis(command, timeoutMs = 5000) {
  const config = getRedisConfig();
  if (!config) throw new Error("Redis belum dikonfigurasi");

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(timeoutMs)
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Redis HTTP ${response.status}`);
  if (data?.error) throw new Error(`Redis error: ${data.error}`);
  return data?.result ?? null;
}

export async function getJson(key) {
  if (isPersistent()) {
    const raw = await redis(["GET", key]);
    if (typeof raw !== "string" || !raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt <= Date.now()) {
    memoryStore.delete(key);
    return null;
  }
  return entry.value;
}

export async function setJson(key, value, ttlSeconds = 0) {
  if (isPersistent()) {
    const command = ttlSeconds > 0
      ? ["SET", key, JSON.stringify(value), "EX", ttlSeconds]
      : ["SET", key, JSON.stringify(value)];
    await redis(command);
    return;
  }

  memoryStore.set(key, {
    value,
    expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : 0
  });
}

export async function del(key) {
  if (isPersistent()) {
    await redis(["DEL", key]);
    return;
  }
  memoryStore.delete(key);
}

/**
 * SET key value EX ttl NX. Returns true only when this caller created the key.
 */
export async function setIfAbsent(key, value, ttlSeconds) {
  if (isPersistent()) {
    const result = await redis(["SET", key, String(value), "EX", ttlSeconds, "NX"]);
    return result === "OK";
  }

  const entry = memoryStore.get(key);
  if (entry && (!entry.expiresAt || entry.expiresAt > Date.now())) return false;
  memoryStore.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000
  });
  return true;
}

export async function incrWithTtl(key, ttlSeconds) {
  if (isPersistent()) {
    const count = Number(await redis(["INCR", key]));
    if (count === 1) await redis(["EXPIRE", key, ttlSeconds]);
    return count;
  }

  const now = Date.now();
  const entry = memoryStore.get(key);
  if (!entry || (entry.expiresAt && entry.expiresAt <= now)) {
    memoryStore.set(key, { value: 1, expiresAt: now + ttlSeconds * 1000 });
    return 1;
  }
  entry.value = Number(entry.value) + 1;
  return entry.value;
}

/** Test helper: wipe the in-memory fallback. */
export function clearMemoryStoreForTests() {
  memoryStore.clear();
}
