import { generateRandomToken, hashPassword, hashToken, timingSafeEqual } from "./_crypto.js";
import { httpContext } from "./_http.js";
import { clientIp, enforceRateLimit } from "./_rateLimit.js";
import { getRestAuth } from "./_settings.js";
import { getUserSecret } from "./_sessionAuth.js";

const HTTP_OPTIONS = { methods: "POST, OPTIONS", allowHeaders: "Content-Type" };
const RESET_TTL_MS = 30 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 8;

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function hashIterations(env) {
  const configured = Number(env.PASSWORD_HASH_ITERATIONS);
  return Number.isInteger(configured) && configured >= 10_000 ? configured : undefined;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

async function sendResetEmail(env, email, resetUrl) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL || "L&B Cattery <onboarding@resend.dev>",
      to: [email],
      subject: "Reset your L&B Cattery password",
      html: `
        <p>We received a request to reset your L&amp;B Cattery account password.</p>
        <p><a href="${escapeHtml(resetUrl)}">Click here to set a new password</a></p>
        <p>This link expires in 30 minutes. If you didn't request this, you can ignore this email.</p>
      `,
    }),
  });

  if (!res.ok) {
    throw new Error(`Resend API failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
}

export async function onRequest({ request, env }) {
  const http = httpContext(request, env, HTTP_OPTIONS);

  if (request.method === "OPTIONS") return http.preflight();
  if (request.method !== "POST") return http.json({ error: "Not found" }, 404);

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return http.json({ error: "Service unavailable" }, 500);
  }

  const userSecret = getUserSecret(env);
  if (!userSecret) {
    console.error("Password reset is not configured: set USER_TOKEN_SECRET.");
    return http.json({ error: "Password reset is not configured." }, 500);
  }

  if (!env.RESEND_API_KEY) {
    console.error("Password reset is not configured: set RESEND_API_KEY.");
    return http.json({ error: "Password reset is not configured." }, 500);
  }

  const usersBase = `${env.SUPABASE_URL}/rest/v1/app_users`;
  const auth = getRestAuth(env);
  const body = await request.json().catch(() => null);
  const action = String(body?.action || "").trim().toLowerCase();

  if (action === "request") {
    const email = normalizeEmail(body?.email);
    if (!email) return http.json({ error: "Email is required" }, 400);

    const limited = await enforceRateLimit(env, http, {
      key: `reset-request:${clientIp(request)}`,
      limit: 5,
      windowSeconds: 60 * 60,
      message: "Too many reset requests. Please wait and try again.",
    });
    if (limited) return limited;

    const lookupRes = await fetch(`${usersBase}?email=eq.${encodeURIComponent(email)}&select=id&limit=1`, { headers: auth });
    const rows = lookupRes.ok ? await lookupRes.json().catch(() => []) : [];
    const user = Array.isArray(rows) ? rows[0] : null;

    // Always respond the same way whether or not the email exists, so this endpoint can't be used to enumerate accounts.
    if (user) {
      const token = generateRandomToken();
      await fetch(`${usersBase}?id=eq.${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        headers: { ...auth, Prefer: "return=minimal" },
        body: JSON.stringify({
          reset_token_hash: await hashToken(token, userSecret),
          reset_expires_at: new Date(Date.now() + RESET_TTL_MS).toISOString(),
        }),
      });

      const resetUrl = `${new URL(request.url).origin}/user-login.html?reset=${encodeURIComponent(token)}`;
      await sendResetEmail(env, email, resetUrl).catch((err) => console.error("sendResetEmail failed", err));
    }

    return http.json({ ok: true, message: "If that email is registered, a reset link has been sent." });
  }

  if (action === "confirm") {
    const limited = await enforceRateLimit(env, http, {
      key: `reset-confirm:${clientIp(request)}`,
      limit: 10,
      windowSeconds: 60 * 60,
      message: "Too many attempts. Please request a new reset link.",
    });
    if (limited) return limited;

    const token = String(body?.token || "").trim();
    const password = String(body?.password || "");

    if (!token || !password) {
      return http.json({ error: "Token and new password are required" }, 400);
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return http.json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` }, 400);
    }

    const tokenHash = await hashToken(token, userSecret);
    const lookupRes = await fetch(
      `${usersBase}?reset_token_hash=eq.${encodeURIComponent(tokenHash)}&select=id,reset_token_hash,reset_expires_at&limit=1`,
      { headers: auth },
    );

    if (!lookupRes.ok) {
      console.error("reset lookup failed", lookupRes.status, await lookupRes.text().catch(() => ""));
      return http.json({ error: "Could not validate the reset link. Please try again." }, 500);
    }

    const rows = await lookupRes.json().catch(() => []);
    const user = Array.isArray(rows) ? rows[0] : null;
    const expired = !user?.reset_expires_at || new Date(user.reset_expires_at) < new Date();

    if (!user || expired || !timingSafeEqual(user.reset_token_hash, tokenHash)) {
      return http.json({ error: "Reset link is invalid or has expired" }, 400);
    }

    const updateRes = await fetch(`${usersBase}?id=eq.${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      headers: { ...auth, Prefer: "return=minimal" },
      body: JSON.stringify({
        password_hash: await hashPassword(password, hashIterations(env)),
        reset_token_hash: null,
        reset_expires_at: null,
      }),
    });

    if (!updateRes.ok) {
      console.error("password reset update failed", updateRes.status, await updateRes.text().catch(() => ""));
      return http.json({ error: "Could not update your password. Please try again." }, 500);
    }

    return http.json({ ok: true });
  }

  return http.json({ error: "Invalid action" }, 400);
}
