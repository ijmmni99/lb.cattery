import { getRestAuth } from "./_settings.js";
import { OCCUPYING_STATUSES, countCats, isValidDate } from "./_bookingRules.js";

const CORS = {
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

const DEFAULT_PAST_DAYS = 45;
const DEFAULT_FUTURE_DAYS = 400;
const MS_PER_DAY = 86400000;

function isoDay(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * Public occupancy feed for the availability checker and calendar.
 *
 * This deliberately exposes NO personal data -- only which suite is occupied, for
 * which nights, by how many cats. `GET /api/bookings` used to be public and
 * returned owner names, emails, phone numbers and care notes to anyone who asked.
 */
export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: CORS });
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return new Response(JSON.stringify({ error: "Service unavailable" }), { status: 500, headers: CORS });
  }

  const { searchParams } = new URL(request.url);
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const from = isValidDate(fromParam) ? fromParam : isoDay(-DEFAULT_PAST_DAYS);
  const to = isValidDate(toParam) ? toParam : isoDay(DEFAULT_FUTURE_DAYS);

  const query = [
    `select=suite_type,check_in,check_out,cats`,
    `status=in.(${OCCUPYING_STATUSES.join(",")})`,
    `check_in=lt.${encodeURIComponent(to)}`,
    `check_out=gt.${encodeURIComponent(from)}`,
    `order=check_in.asc`,
  ].join("&");

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/bookings?${query}`, { headers: getRestAuth(env) });

  if (!res.ok) {
    console.error("availability query failed", res.status, await res.text().catch(() => ""));
    return new Response(JSON.stringify({ error: "Failed to load availability" }), { status: 500, headers: CORS });
  }

  const rows = await res.json().catch(() => []);
  const occupancy = (Array.isArray(rows) ? rows : []).map((row) => ({
    suiteType: row.suite_type,
    checkIn: row.check_in,
    checkOut: row.check_out,
    cats: countCats(row),
  }));

  return new Response(JSON.stringify({ from, to, occupancy }), { headers: CORS });
}
