import { corsHeaders, json, notConfigured, supabaseHeaders } from "./_common.js";
import { getTokenFromRequest, verifySessionToken } from "./_sessionAuth.js";

export async function onRequest({ request, env }) {
  const cors = corsHeaders(request, env, { methods: "GET, OPTIONS", headers: "Content-Type, x-user-token, authorization" });

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  if (request.method !== "GET") {
    return json(cors, { error: "Not found" }, 404);
  }

  const auth = supabaseHeaders(env);
  if (!auth || !env.USER_TOKEN_SECRET) return notConfigured(cors);

  const token = getTokenFromRequest(request, "x-user-token");
  const payload = await verifySessionToken(token, env.USER_TOKEN_SECRET);
  const email = String(payload?.sub || "").trim().toLowerCase();

  if (!email) return json(cors, { error: "Unauthorized" }, 401);

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/bookings?owner_email=eq.${encodeURIComponent(email)}&select=id,owner_name,owner_email,owner_phone,cats,cat_name,breed,age,suite_type,check_in,check_out,add_ons,add_on,total_price,notes,status&order=check_in.asc`,
    { headers: auth },
  );

  if (!res.ok) return json(cors, { error: "Failed to load bookings" }, 500);

  return json(cors, await res.json());
}
