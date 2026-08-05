import { createSessionToken, getTokenFromRequest, hashPassword, verifySessionToken } from "./_sessionAuth.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-user-token, authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

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

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return new Response(JSON.stringify({ error: "Missing Supabase env vars" }), { status: 500, headers: CORS });
  }

  const usersBase = `${env.SUPABASE_URL}/rest/v1/app_users`;
  const auth = getSupabaseAuth(env);
  const userSecret = getUserSecret(env);

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

    const passwordHash = await hashPassword(password, userSecret);
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

    const passwordHash = await hashPassword(password, userSecret);
    if (passwordHash !== user.password_hash) {
      return new Response(JSON.stringify({ error: "Invalid credentials" }), { status: 401, headers: CORS });
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
