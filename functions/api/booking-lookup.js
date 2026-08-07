const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: CORS });
  }

  const { SUPABASE_URL, SUPABASE_ANON_KEY } = env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return new Response(JSON.stringify({ error: "Missing Supabase env vars" }), { status: 500, headers: CORS });
  }

  const body = await request.json().catch(() => null);
  const bookingId = String(body?.bookingId || "").trim();
  const email = normalizeEmail(body?.email);

  if (!bookingId || !email) {
    return new Response(JSON.stringify({ error: "Booking ID and email are required" }), { status: 400, headers: CORS });
  }

  const base = `${SUPABASE_URL}/rest/v1/bookings`;
  const auth = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
  };

  const res = await fetch(
    `${base}?id=eq.${encodeURIComponent(bookingId)}&owner_email=eq.${encodeURIComponent(email)}&select=id,owner_name,owner_email,owner_phone,cats,cat_name,breed,age,suite_type,check_in,check_out,add_ons,add_on,total_price,notes,status&limit=1`,
    { headers: auth },
  );

  if (!res.ok) {
    return new Response(JSON.stringify({ error: "Failed to look up booking" }), { status: 500, headers: CORS });
  }

  const rows = await res.json();
  const booking = Array.isArray(rows) ? rows[0] : null;

  if (!booking) {
    return new Response(JSON.stringify({ error: "No booking found matching that ID and email" }), { status: 404, headers: CORS });
  }

  return new Response(JSON.stringify(booking), { headers: CORS });
}
