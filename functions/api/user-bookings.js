import { httpContext } from "./_http.js";
import { getRestAuth } from "./_settings.js";
import { getTokenFromRequest, getUserSecret, verifySessionToken } from "./_sessionAuth.js";

const HTTP_OPTIONS = {
  methods: "GET, OPTIONS",
  allowHeaders: "Content-Type, x-user-token, authorization",
};

const SELECT_COLUMNS = [
  "id", "owner_name", "owner_email", "owner_phone",
  "cats", "cat_name", "breed", "age",
  "suite_type", "check_in", "check_out",
  "add_ons", "add_on", "total_price", "notes", "status",
].join(",");

export async function onRequest({ request, env }) {
  const http = httpContext(request, env, HTTP_OPTIONS);

  if (request.method === "OPTIONS") return http.preflight();
  if (request.method !== "GET") return http.json({ error: "Not found" }, 404);

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return http.json({ error: "Service unavailable" }, 500);
  }

  const userSecret = getUserSecret(env);
  if (!userSecret) {
    console.error("Customer auth is not configured: set USER_TOKEN_SECRET.");
    return http.json({ error: "Customer accounts are not configured." }, 500);
  }

  const payload = await verifySessionToken(getTokenFromRequest(request, "x-user-token"), userSecret);
  const email = String(payload?.sub || "").trim().toLowerCase();
  if (!email) {
    return http.json({ error: "Unauthorized" }, 401);
  }

  const query = [
    `owner_email=eq.${encodeURIComponent(email)}`,
    `select=${SELECT_COLUMNS}`,
    "order=check_in.asc",
  ].join("&");

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/bookings?${query}`, { headers: getRestAuth(env) });

  if (!res.ok) {
    console.error("user bookings query failed", res.status, await res.text().catch(() => ""));
    return http.json({ error: "Failed to load bookings" }, 500);
  }

  return http.json(await res.json());
}
