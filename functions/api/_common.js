// Shared helpers for all API routes: CORS, JSON responses, Supabase access,
// constant-time comparison and optional KV rate limiting.

export function corsHeaders(request, env, { methods = "GET, POST, OPTIONS", headers = "Content-Type" } = {}) {
  const origin = env.ALLOWED_ORIGIN || new URL(request.url).origin;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": headers,
    "Access-Control-Allow-Methods": methods,
    Vary: "Origin",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}

export function json(cors, data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, ...extra } });
}

export function notConfigured(cors) {
  return json(cors, { error: "Server not configured" }, 500);
}

// Supabase REST headers using the service-role key only. Returns null when not configured (fail closed).
export function supabaseHeaders(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
}

const encoder = new TextEncoder();

export function timingSafeEqual(a, b) {
  const x = encoder.encode(String(a ?? ""));
  const y = encoder.encode(String(b ?? ""));
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i += 1) {
    diff |= (x[i] || 0) ^ (y[i] || 0);
  }
  return diff === 0;
}

// Compare two secrets without leaking length or content: hash both first, then compare the fixed-size digests.
export async function secretsMatch(provided, expected) {
  if (!expected) return false;
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(String(provided ?? ""))),
    crypto.subtle.digest("SHA-256", encoder.encode(String(expected))),
  ]);
  return timingSafeEqual(new Uint8Array(a).join(","), new Uint8Array(b).join(","));
}

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_SECONDS = 600;

// Returns a 429 Response when the caller is over the limit, otherwise null.
// Skips silently when the RATE_LIMIT KV namespace is not bound.
export async function rateLimit(request, env, route, cors, { max = RATE_LIMIT_MAX, windowSeconds = RATE_LIMIT_WINDOW_SECONDS } = {}) {
  const kv = env.RATE_LIMIT;
  if (!kv || typeof kv.get !== "function") return null;

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = `rl:${route}:${ip}`;
  const now = Math.floor(Date.now() / 1000);

  try {
    const raw = await kv.get(key);
    let state = raw ? JSON.parse(raw) : null;
    if (!state || state.reset <= now) state = { count: 0, reset: now + windowSeconds };

    if (state.count >= max) {
      const retryAfter = Math.max(1, state.reset - now);
      return json(cors, { error: "Too many requests. Please try again later." }, 429, { "Retry-After": String(retryAfter) });
    }

    state.count += 1;
    await kv.put(key, JSON.stringify(state), { expirationTtl: Math.max(60, state.reset - now) });
  } catch (err) {
    console.error("rateLimit failed", err);
  }
  return null;
}
