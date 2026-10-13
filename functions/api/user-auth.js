import { corsHeaders, json, notConfigured, rateLimit, supabaseHeaders } from "./_common.js";
import { createSessionToken, getTokenFromRequest, hashPassword, verifyPassword, verifySessionToken } from "./_sessionAuth.js";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export async function onRequest({ request, env }) {
  const CORS = corsHeaders(request, env, { headers: "Content-Type, x-user-token, authorization" });

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  const auth = supabaseHeaders(env);
  const userSecret = env.USER_TOKEN_SECRET || "";
  if (!auth || !userSecret) return notConfigured(CORS);

  const usersBase = `${env.SUPABASE_URL}/rest/v1/app_users`;

  if (request.method === "GET") {
    const token = getTokenFromRequest(request, "x-user-token");
    const payload = await verifySessionToken(token, userSecret);
    if (!payload?.sub) {
      return new Response(JSON.stringify({ ok: false }), { status: 401, headers: CORS });
    }

    return new Response(JSON.stringify({ ok: true, email: payload.sub, name: payload.name || "" }), { headers: CORS });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: CORS });
  }

  const limited = await rateLimit(request, env, "user-auth", CORS);
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const action = String(body?.action || "").trim().toLowerCase();

  if (action === "signup") {
    const fullName = String(body?.fullName || "").trim();
    const phone = String(body?.phone || "").trim();
    const email = normalizeEmail(body?.email);
    const password = String(body?.password || "");

    if (!fullName || !email || !password) {
      return new Response(JSON.stringify({ error: "Full name, email, and password are required" }), { status: 400, headers: CORS });
    }

    if (password.length < 8) {
      return new Response(JSON.stringify({ error: "Password must be at least 8 characters" }), { status: 400, headers: CORS });
    }

    const existingRes = await fetch(`${usersBase}?email=eq.${encodeURIComponent(email)}&select=id&limit=1`, { headers: auth });
    if (!existingRes.ok) {
      const detail = await existingRes.text();
      return new Response(
        JSON.stringify({
          error: "Failed to validate user",
          hint: "Check table public.app_users exists and API key has select permission.",
          status: existingRes.status,
          detail,
        }),
        { status: 500, headers: CORS },
      );
    }

    const existingRows = await existingRes.json();
    if (Array.isArray(existingRows) && existingRows.length > 0) {
      return new Response(JSON.stringify({ error: "Email is already registered" }), { status: 409, headers: CORS });
    }

    const passwordHash = await hashPassword(password, env);
    const userId = `USR-${Date.now().toString(36)}-${Math.floor(Math.random() * 100000).toString(36)}`;

    const insertRes = await fetch(usersBase, {
      method: "POST",
      headers: {
        ...auth,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        id: userId,
        full_name: fullName,
        phone,
        email,
        password_hash: passwordHash,
        created_at: new Date().toISOString(),
      }),
    });

    if (!insertRes.ok) {
      const detail = await insertRes.text();
      return new Response(
        JSON.stringify({
          error: "Failed to create user",
          hint: "Check app_users schema, unique email constraint, and insert permission.",
          status: insertRes.status,
          detail,
        }),
        { status: 500, headers: CORS },
      );
    }

    const token = await createSessionToken(email, userSecret, 12 * 60 * 60 * 1000, { name: fullName, role: "user" });
    return new Response(JSON.stringify({ ok: true, token, user: { fullName, email, phone } }), { headers: CORS });
  }

  if (action === "login") {
    const email = normalizeEmail(body?.email);
    const password = String(body?.password || "");

    if (!email || !password) {
      return new Response(JSON.stringify({ error: "Email and password are required" }), { status: 400, headers: CORS });
    }

    const res = await fetch(
      `${usersBase}?email=eq.${encodeURIComponent(email)}&select=id,full_name,phone,email,password_hash&limit=1`,
      { headers: auth },
    );

    if (!res.ok) {
      const detail = await res.text();
      return new Response(
        JSON.stringify({
          error: "Login service unavailable",
          hint: "Check table public.app_users exists and API key has select permission.",
          status: res.status,
          detail,
        }),
        { status: 500, headers: CORS },
      );
    }

    const rows = await res.json();
    const user = Array.isArray(rows) ? rows[0] : null;
    if (!user) {
      return new Response(JSON.stringify({ error: "Invalid credentials" }), { status: 401, headers: CORS });
    }

    // Old rows were hashed with SHA-256 + USER_TOKEN_SECRET (or the anon key on deployments that relied on the old fallback).
    const legacySecret = env.LEGACY_PASSWORD_SECRET || userSecret;
    const { ok, needsUpgrade } = await verifyPassword(password, user.password_hash, legacySecret, env);
    if (!ok) {
      return new Response(JSON.stringify({ error: "Invalid credentials" }), { status: 401, headers: CORS });
    }

    if (needsUpgrade) {
      try {
        const upgraded = await hashPassword(password, env);
        const upRes = await fetch(`${usersBase}?id=eq.${encodeURIComponent(user.id)}`, {
          method: "PATCH",
          headers: { ...auth, Prefer: "return=minimal" },
          body: JSON.stringify({ password_hash: upgraded }),
        });
        if (!upRes.ok) console.error("password upgrade failed", upRes.status);
      } catch (err) {
        console.error("password upgrade failed", err);
      }
    }

    const token = await createSessionToken(email, userSecret, 12 * 60 * 60 * 1000, {
      name: user.full_name || "",
      role: "user",
    });

    return new Response(
      JSON.stringify({
        ok: true,
        token,
        user: {
          fullName: user.full_name || "",
          email: user.email,
          phone: user.phone || "",
        },
      }),
      { headers: CORS },
    );
  }

  return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers: CORS });
}
