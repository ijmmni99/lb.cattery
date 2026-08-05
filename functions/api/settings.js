import { getAdminSecret, getAdminTokenFromRequest, verifyAdminToken } from "./_adminAuth.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-admin-token, x-admin-key, authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

const DEFAULT_SETTINGS = {
  booking: {
    allowPublicBooking: true,
    minNights: 1,
    maxNights: 30,
  },
  suites: [
    { code: "standard", name: "Standard Suite", nightlyRate: 20, capacity: 6, active: true },
    { code: "deluxe", name: "Deluxe Suite", nightlyRate: 35, capacity: 4, active: true },
    { code: "royal", name: "Royal Suite", nightlyRate: 55, capacity: 2, active: true },
  ],
  addons: [
    { code: "none", name: "No add-on", flatFee: 0, nightlyFee: 0, active: true },
    { code: "grooming", name: "Grooming Package", flatFee: 18, nightlyFee: 0, active: true },
    { code: "playtime", name: "Extended Playtime", flatFee: 0, nightlyFee: 10, active: true },
    { code: "medication", name: "Medication Support", flatFee: 12, nightlyFee: 0, active: true },
  ],
};

function sanitizeSettings(input) {
  const safe = input && typeof input === "object" ? input : {};
  const booking = safe.booking && typeof safe.booking === "object" ? safe.booking : {};

  const suites = Array.isArray(safe.suites) ? safe.suites : [];
  const addons = Array.isArray(safe.addons) ? safe.addons : [];

  return {
    booking: {
      allowPublicBooking: booking.allowPublicBooking !== false,
      minNights: Number(booking.minNights) > 0 ? Number(booking.minNights) : 1,
      maxNights: Number(booking.maxNights) > 0 ? Number(booking.maxNights) : 30,
    },
    suites: suites
      .map((suite) => ({
        code: String(suite.code || "").trim(),
        name: String(suite.name || "").trim(),
        nightlyRate: Number(suite.nightlyRate) || 0,
        capacity: Math.max(1, Number(suite.capacity) || 1),
        active: suite.active !== false,
      }))
      .filter((suite) => suite.code && suite.name),
    addons: addons
      .map((addon) => ({
        code: String(addon.code || "").trim(),
        name: String(addon.name || "").trim(),
        flatFee: Number(addon.flatFee) || 0,
        nightlyFee: Number(addon.nightlyFee) || 0,
        active: addon.active !== false,
      }))
      .filter((addon) => addon.code && addon.name),
  };
}

async function readSettings(base, headers) {
  const res = await fetch(`${base}?key=eq.global&select=value&limit=1`, { headers });
  if (!res.ok) {
    return DEFAULT_SETTINGS;
  }

  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0 || !rows[0].value) {
    return DEFAULT_SETTINGS;
  }

  const merged = {
    ...DEFAULT_SETTINGS,
    ...rows[0].value,
  };

  return sanitizeSettings(merged);
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  const { SUPABASE_URL, SUPABASE_ANON_KEY, ADMIN_API_KEY } = env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return new Response(JSON.stringify({ error: "Missing Supabase env vars" }), { status: 500, headers: CORS });
  }

  const base = `${SUPABASE_URL}/rest/v1/system_config`;
  const auth = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
  };

  if (request.method === "GET") {
    const settings = await readSettings(base, auth);

    // Auto-bootstrap default row if table exists but no record has been created yet.
    await fetch(base, {
      method: "POST",
      headers: {
        ...auth,
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        key: "global",
        value: settings,
        updated_at: new Date().toISOString(),
      }),
    }).catch(() => null);

    return new Response(JSON.stringify(settings), { headers: CORS });
  }

  if (request.method === "POST") {
    const adminSecret = getAdminSecret(env);
    const token = getAdminTokenFromRequest(request);
    const isTokenValid = await verifyAdminToken(token, adminSecret);

    const expectedAdminKey = ADMIN_API_KEY || SUPABASE_ANON_KEY;
    const providedKey = request.headers.get("x-admin-key") || "";
    const isLegacyKeyValid = Boolean(expectedAdminKey && providedKey === expectedAdminKey);

    if (!isTokenValid && !isLegacyKeyValid) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
    }

    const body = await request.json();
    const settings = sanitizeSettings(body);

    const upsertPayload = {
      key: "global",
      value: settings,
      updated_at: new Date().toISOString(),
    };

    const res = await fetch(base, {
      method: "POST",
      headers: {
        ...auth,
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(upsertPayload),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return new Response(
        JSON.stringify({ error: "Failed to save settings", status: res.status, detail }),
        { status: 500, headers: CORS },
      );
    }

    return new Response(JSON.stringify({ ok: true }), { headers: CORS });
  }

  return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: CORS });
}
