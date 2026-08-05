import { createAdminToken, getAdminSecret, getAdminTokenFromRequest, verifyAdminToken } from "./_adminAuth.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-admin-token, authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  const adminSecret = getAdminSecret(env);
  if (!adminSecret) {
    return new Response(JSON.stringify({ error: "Admin auth is not configured" }), { status: 500, headers: CORS });
  }

  if (request.method === "GET") {
    const token = getAdminTokenFromRequest(request);
    const valid = await verifyAdminToken(token, adminSecret);
    if (!valid) {
      return new Response(JSON.stringify({ ok: false }), { status: 401, headers: CORS });
    }

    return new Response(JSON.stringify({ ok: true }), { headers: CORS });
  }

  if (request.method === "POST") {
    const body = await request.json().catch(() => null);
    const username = String(body?.username || "").trim();
    const password = String(body?.password || "");

    const expectedUsername = env.ADMIN_USERNAME || "admin";
    const expectedPassword = env.ADMIN_PASSWORD || env.ADMIN_API_KEY || env.SUPABASE_ANON_KEY || "";

    if (!expectedPassword || username !== expectedUsername || password !== expectedPassword) {
      return new Response(JSON.stringify({ error: "Invalid credentials" }), { status: 401, headers: CORS });
    }

    const token = await createAdminToken(username, adminSecret);
    return new Response(JSON.stringify({ ok: true, token }), { headers: CORS });
  }

  return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: CORS });
}
