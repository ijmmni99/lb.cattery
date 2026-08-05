import { getTokenFromRequest, verifySessionToken } from "./_sessionAuth.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-user-token, authorization",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

function getUserSecret(env) {
  return env.USER_TOKEN_SECRET || env.SUPABASE_ANON_KEY || "";
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: CORS });
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return new Response(JSON.stringify({ error: "Missing Supabase env vars" }), { status: 500, headers: CORS });
  }

  const token = getTokenFromRequest(request, "x-user-token");
  const payload = await verifySessionToken(token, getUserSecret(env));
  const email = String(payload?.sub || "").trim().toLowerCase();

  if (!email) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
  }

  const base = `${env.SUPABASE_URL}/rest/v1/bookings`;
  const restKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
  const auth = {
    apikey: restKey,
    Authorization: `Bearer ${restKey}`,
    "Content-Type": "application/json",
  };

  const res = await fetch(
    `${base}?owner_email=eq.${encodeURIComponent(email)}&select=id,owner_name,owner_email,owner_phone,cat_name,breed,age,suite_type,check_in,check_out,add_on,total_price,notes&order=check_in.asc`,
    { headers: auth },
  );

  if (!res.ok) {
    return new Response(JSON.stringify({ error: "Failed to load bookings" }), { status: 500, headers: CORS });
  }

  const rows = await res.json();
  return new Response(JSON.stringify(rows), { headers: CORS });
}
