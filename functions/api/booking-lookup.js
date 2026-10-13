import { corsHeaders, json, notConfigured, rateLimit, supabaseHeaders } from "./_common.js";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export async function onRequest({ request, env }) {
  const cors = corsHeaders(request, env, { methods: "POST, OPTIONS" });

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  if (request.method !== "POST") {
    return json(cors, { error: "Not found" }, 404);
  }

  const auth = supabaseHeaders(env);
  if (!auth) return notConfigured(cors);

  const limited = await rateLimit(request, env, "booking-lookup", cors);
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const bookingId = String(body?.bookingId || "").trim().toUpperCase();
  const email = normalizeEmail(body?.email);

  if (!bookingId || !email) {
    return json(cors, { error: "Booking ID and email are required" }, 400);
  }

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(bookingId)}&owner_email=eq.${encodeURIComponent(email)}&select=id,owner_name,owner_email,owner_phone,cats,cat_name,breed,age,suite_type,check_in,check_out,add_ons,add_on,total_price,notes,status&limit=1`,
    { headers: auth },
  );

  if (!res.ok) return json(cors, { error: "Failed to look up booking" }, 500);

  const rows = await res.json();
  const booking = Array.isArray(rows) ? rows[0] : null;

  if (!booking) return json(cors, { error: "No booking found matching that ID and email" }, 404);

  return json(cors, booking);
}
