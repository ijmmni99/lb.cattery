import { hashPassword, verifyPassword } from "./_crypto.js";
import { httpContext } from "./_http.js";
import { clientIp, enforceRateLimit } from "./_rateLimit.js";
import { getRestAuth } from "./_settings.js";
import {
  createSessionToken,
  getLegacyPasswordSecrets,
  getTokenFromRequest,
  getUserSecret,
  verifySessionToken,
} from "./_sessionAuth.js";

const HTTP_OPTIONS = {
  methods: "GET, POST, OPTIONS",
  allowHeaders: "Content-Type, x-user-token, authorization",
};

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function hashIterations(env) {
  const configured = Number(env.PASSWORD_HASH_ITERATIONS);
  return Number.isInteger(configured) && configured >= 10_000 ? configured : undefined;
}

/** Rewrites a verified legacy hash in the modern format. Best effort: a failure here must not block the login. */
async function upgradeStoredHash(usersBase, auth, userId, password, env) {
  try {
    const upgraded = await hashPassword(password, hashIterations(env));
    await fetch(`${usersBase}?id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: { ...auth, Prefer: "return=minimal" },
      body: JSON.stringify({ password_hash: upgraded }),
    });
  } catch (err) {
    console.error("password hash upgrade failed", err);
  }
}

export async function onRequest({ request, env }) {
  const http = httpContext(request, env, HTTP_OPTIONS);

  if (request.method === "OPTIONS") return http.preflight();

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return http.json({ error: "Service unavailable" }, 500);
  }

  const userSecret = getUserSecret(env);
  if (!userSecret) {
    console.error("Customer auth is not configured: set USER_TOKEN_SECRET. Falling back to SUPABASE_ANON_KEY is no longer supported.");
    return http.json({ error: "Customer accounts are not configured." }, 500);
  }

  const usersBase = `${env.SUPABASE_URL}/rest/v1/app_users`;
  const auth = getRestAuth(env);

  if (request.method === "GET") {
    const payload = await verifySessionToken(getTokenFromRequest(request, "x-user-token"), userSecret);
    if (!payload?.sub) return http.json({ ok: false }, 401);

    return http.json({ ok: true, email: payload.sub, name: payload.name || "" });
  }

  if (request.method !== "POST") {
    return http.json({ error: "Not found" }, 404);
  }

  const body = await request.json().catch(() => null);
  const action = String(body?.action || "").trim().toLowerCase();

  if (action === "signup") {
    const limited = await enforceRateLimit(env, http, {
      key: `signup:${clientIp(request)}`,
      limit: 5,
      windowSeconds: 60 * 60,
      message: "Too many sign-up attempts. Please wait and try again.",
    });
    if (limited) return limited;

    const fullName = String(body?.fullName || "").trim().slice(0, 200);
    const phone = String(body?.phone || "").trim().slice(0, 50);
    const email = normalizeEmail(body?.email);
    const password = String(body?.password || "");

    if (!fullName || !email || !password) {
      return http.json({ error: "Full name, email, and password are required" }, 400);
    }
    if (!EMAIL_PATTERN.test(email)) {
      return http.json({ error: "Please enter a valid email address" }, 400);
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return http.json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` }, 400);
    }

    const existingRes = await fetch(`${usersBase}?email=eq.${encodeURIComponent(email)}&select=id&limit=1`, { headers: auth });
    if (!existingRes.ok) {
      console.error("signup lookup failed", existingRes.status, await existingRes.text().catch(() => ""));
      return http.json({ error: "Sign up is unavailable right now. Please try again." }, 500);
    }

    const existingRows = await existingRes.json().catch(() => []);
    if (Array.isArray(existingRows) && existingRows.length > 0) {
      return http.json({ error: "Email is already registered" }, 409);
    }

    const insertRes = await fetch(usersBase, {
      method: "POST",
      headers: { ...auth, Prefer: "return=minimal" },
      body: JSON.stringify({
        id: `USR-${crypto.randomUUID()}`,
        full_name: fullName,
        phone,
        email,
        password_hash: await hashPassword(password, hashIterations(env)),
        created_at: new Date().toISOString(),
      }),
    });

    if (!insertRes.ok) {
      console.error("signup insert failed", insertRes.status, await insertRes.text().catch(() => ""));
      return http.json({ error: "Could not create your account. Please try again." }, 500);
    }

    const token = await createSessionToken(email, userSecret, SESSION_TTL_MS, { name: fullName, role: "user" });
    return http.json({ ok: true, token, user: { fullName, email, phone } });
  }

  if (action === "login") {
    const limited = await enforceRateLimit(env, http, {
      key: `login:${clientIp(request)}`,
      limit: 10,
      windowSeconds: 15 * 60,
      message: "Too many sign-in attempts. Please wait a few minutes and try again.",
    });
    if (limited) return limited;

    const email = normalizeEmail(body?.email);
    const password = String(body?.password || "");

    if (!email || !password) {
      return http.json({ error: "Email and password are required" }, 400);
    }

    const res = await fetch(
      `${usersBase}?email=eq.${encodeURIComponent(email)}&select=id,full_name,phone,email,password_hash&limit=1`,
      { headers: auth },
    );

    if (!res.ok) {
      console.error("login lookup failed", res.status, await res.text().catch(() => ""));
      return http.json({ error: "Login is unavailable right now. Please try again." }, 500);
    }

    const rows = await res.json().catch(() => []);
    const user = Array.isArray(rows) ? rows[0] : null;
    if (!user) {
      return http.json({ error: "Invalid credentials" }, 401);
    }

    const { valid, needsUpgrade } = await verifyPassword(password, user.password_hash, getLegacyPasswordSecrets(env));
    if (!valid) {
      return http.json({ error: "Invalid credentials" }, 401);
    }

    // Transparently migrate the old unsalted SHA-256 hash on first successful login.
    if (needsUpgrade) {
      await upgradeStoredHash(usersBase, auth, user.id, password, env);
    }

    const token = await createSessionToken(email, userSecret, SESSION_TTL_MS, {
      name: user.full_name || "",
      role: "user",
    });

    return http.json({
      ok: true,
      token,
      user: { fullName: user.full_name || "", email: user.email, phone: user.phone || "" },
    });
  }

  return http.json({ error: "Invalid action" }, 400);
}
