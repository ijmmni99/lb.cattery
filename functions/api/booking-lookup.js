import { httpContext } from "./_http.js";
import { clientIp, enforceRateLimit } from "./_rateLimit.js";
import { getRestAuth } from "./_settings.js";

const HTTP_OPTIONS = { methods: "POST, OPTIONS", allowHeaders: "Content-Type" };

const SELECT_COLUMNS = [
  "id", "owner_name", "owner_email", "owner_phone",
  "cats", "cat_name", "breed", "age",
  "suite_type", "check_in", "check_out",
  "add_ons", "add_on", "total_price", "notes", "status",
].join(",");

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export async function onRequest({ request, env }) {
  const http = httpContext(request, env, HTTP_OPTIONS);

  if (request.method === "OPTIONS") return http.preflight();
  if (request.method !== "POST") return http.json({ error: "Not found" }, 404);

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return http.json({ error: "Service unavailable" }, 500);
  }

  // A booking id plus an email is a weak secret, so cap guessing attempts.
  const limited = await enforceRateLimit(env, http, {
    key: `booking-lookup:${clientIp(request)}`,
    limit: 20,
    windowSeconds: 15 * 60,
    message: "Too many lookups. Please wait a few minutes and try again.",
  });
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const bookingId = String(body?.bookingId || "").trim().slice(0, 100);
  const email = normalizeEmail(body?.email).slice(0, 320);

  if (!bookingId || !email) {
    return http.json({ error: "Booking ID and email are required" }, 400);
  }

  const query = [
    `id=eq.${encodeURIComponent(bookingId)}`,
    `owner_email=eq.${encodeURIComponent(email)}`,
    `select=${SELECT_COLUMNS}`,
    "limit=1",
  ].join("&");

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/bookings?${query}`, { headers: getRestAuth(env) });

  if (!res.ok) {
    console.error("booking lookup failed", res.status, await res.text().catch(() => ""));
    return http.json({ error: "Could not look up that booking. Please try again." }, 500);
  }

  const rows = await res.json().catch(() => []);
  const booking = Array.isArray(rows) ? rows[0] : null;

  if (!booking) {
    return http.json({ error: "No booking found matching that ID and email" }, 404);
  }

  return http.json(booking);
}
