/**
 * Fixed-window rate limiting for the endpoints an attacker would hammer:
 * login, signup, password reset, booking lookup and booking submission.
 *
 * Storage: a Workers KV namespace bound as RATE_LIMIT when available, otherwise
 * a per-isolate in-memory map. The in-memory fallback is NOT durable -- an
 * attacker spread across isolates gets a higher effective ceiling -- but it
 * still blunts a single-source brute force. Bind KV in production; see README.
 */

const memoryBuckets = new Map();
const MEMORY_SWEEP_INTERVAL = 1000;
let writesSinceSweep = 0;

function sweepMemory(now) {
  for (const [key, entry] of memoryBuckets) {
    if (entry.expiresAt <= now) memoryBuckets.delete(key);
  }
}

export function clientIp(request) {
  const cfIp = request.headers.get("CF-Connecting-IP");
  if (cfIp) return cfIp;

  const forwarded = request.headers.get("X-Forwarded-For");
  if (forwarded) return forwarded.split(",")[0].trim();

  return "unknown";
}

async function incrementKv(kv, storeKey, ttlSeconds) {
  const current = Number(await kv.get(storeKey)) || 0;
  const next = current + 1;
  // KV enforces a 60 second minimum TTL.
  await kv.put(storeKey, String(next), { expirationTtl: Math.max(60, ttlSeconds) });
  return next;
}

function incrementMemory(storeKey, now, expiresAt) {
  writesSinceSweep += 1;
  if (writesSinceSweep >= MEMORY_SWEEP_INTERVAL) {
    writesSinceSweep = 0;
    sweepMemory(now);
  }

  const entry = memoryBuckets.get(storeKey);
  if (!entry || entry.expiresAt <= now) {
    memoryBuckets.set(storeKey, { count: 1, expiresAt });
    return 1;
  }

  entry.count += 1;
  return entry.count;
}

/**
 * Records one attempt against `key` and reports whether it is allowed.
 * Returns `{ allowed, retryAfter }` where retryAfter is in seconds.
 */
export async function rateLimit(env, { key, limit, windowSeconds }) {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const bucket = Math.floor(now / windowMs);
  const storeKey = `rl:${key}:${bucket}`;
  const resetAt = (bucket + 1) * windowMs;
  const retryAfter = Math.max(1, Math.ceil((resetAt - now) / 1000));

  let count;
  try {
    count = env.RATE_LIMIT
      ? await incrementKv(env.RATE_LIMIT, storeKey, windowSeconds * 2)
      : incrementMemory(storeKey, now, resetAt);
  } catch (err) {
    // Never let a limiter outage take the endpoint down with it.
    console.error("rateLimit store failed", err);
    return { allowed: true, retryAfter: 0 };
  }

  return { allowed: count <= limit, retryAfter };
}

/**
 * Applies a limit and, when exceeded, returns a ready-made 429. Returns null
 * when the request may proceed.
 */
export async function enforceRateLimit(env, http, { key, limit, windowSeconds, message }) {
  const { allowed, retryAfter } = await rateLimit(env, { key, limit, windowSeconds });
  if (allowed) return null;

  return http.json(
    { error: message || "Too many requests. Please wait and try again." },
    429,
    { "Retry-After": String(retryAfter) },
  );
}

/** Test-only: clears the in-memory buckets between cases. */
export function __resetMemoryBuckets() {
  memoryBuckets.clear();
  writesSinceSweep = 0;
}
