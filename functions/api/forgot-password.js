import { generateRandomToken, hashPassword, hashValue } from "./_sessionAuth.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const RESET_TTL_MS = 30 * 60 * 1000;

function getUserSecret(env) {
  return env.USER_TOKEN_SECRET || env.SUPABASE_ANON_KEY || "";
}

function getSupabaseAuth(env) {
  const restKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
  return {
    apikey: restKey,
    Authorization: `Bearer ${restKey}`,
    "Content-Type": "application/json",
  };
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
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
        <p><a href="${resetUrl}">Click here to set a new password</a></p>
        <p>This link expires in 30 minutes. If you didn't request this, you can ignore this email.</p>
      `,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend API failed: ${res.status} ${detail}`);
  }
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: CORS });
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return new Response(JSON.stringify({ error: "Missing Supabase env vars" }), { status: 500, headers: CORS });
  }

  if (!env.RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: "Missing RESEND_API_KEY env var" }), { status: 500, headers: CORS });
  }

  const usersBase = `${env.SUPABASE_URL}/rest/v1/app_users`;
  const auth = getSupabaseAuth(env);
  const userSecret = getUserSecret(env);

  const body = await request.json().catch(() => null);
  const action = String(body?.action || "").trim().toLowerCase();

  if (action === "request") {
    const email = normalizeEmail(body?.email);
    if (!email) {
      return new Response(JSON.stringify({ error: "Email is required" }), { status: 400, headers: CORS });
    }

    const lookupRes = await fetch(`${usersBase}?email=eq.${encodeURIComponent(email)}&select=id&limit=1`, { headers: auth });
    const rows = lookupRes.ok ? await lookupRes.json() : [];
    const user = Array.isArray(rows) ? rows[0] : null;

    // Always respond the same way whether or not the email exists, so this endpoint can't be used to enumerate accounts.
    if (user) {
      const token = generateRandomToken();
      const tokenHash = await hashValue(token, userSecret);
      const expiresAt = new Date(Date.now() + RESET_TTL_MS).toISOString();

      await fetch(`${usersBase}?id=eq.${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        headers: { ...auth, Prefer: "return=minimal" },
        body: JSON.stringify({ reset_token_hash: tokenHash, reset_expires_at: expiresAt }),
      });

      const resetUrl = `${new URL(request.url).origin}/user-login.html?reset=${token}`;
      await sendResetEmail(env, email, resetUrl).catch((err) => console.error("sendResetEmail failed", err));
    }

    return new Response(
      JSON.stringify({ ok: true, message: "If that email is registered, a reset link has been sent." }),
      { headers: CORS },
    );
  }

  if (action === "confirm") {
    const token = String(body?.token || "").trim();
    const password = String(body?.password || "");

    if (!token || !password) {
      return new Response(JSON.stringify({ error: "Token and new password are required" }), { status: 400, headers: CORS });
    }

    if (password.length < 8) {
      return new Response(JSON.stringify({ error: "Password must be at least 8 characters" }), { status: 400, headers: CORS });
    }

    const tokenHash = await hashValue(token, userSecret);
    const lookupRes = await fetch(
      `${usersBase}?reset_token_hash=eq.${encodeURIComponent(tokenHash)}&select=id,reset_expires_at&limit=1`,
      { headers: auth },
    );

    if (!lookupRes.ok) {
      return new Response(JSON.stringify({ error: "Failed to validate reset token" }), { status: 500, headers: CORS });
    }

    const rows = await lookupRes.json();
    const user = Array.isArray(rows) ? rows[0] : null;

    if (!user || !user.reset_expires_at || new Date(user.reset_expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: "Reset link is invalid or has expired" }), { status: 400, headers: CORS });
    }

    const passwordHash = await hashPassword(password, userSecret);

    const updateRes = await fetch(`${usersBase}?id=eq.${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      headers: { ...auth, Prefer: "return=minimal" },
      body: JSON.stringify({ password_hash: passwordHash, reset_token_hash: null, reset_expires_at: null }),
    });

    if (!updateRes.ok) {
      return new Response(JSON.stringify({ error: "Failed to update password" }), { status: 500, headers: CORS });
    }

    return new Response(JSON.stringify({ ok: true }), { headers: CORS });
  }

  return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers: CORS });
}
