import { isAdminRequest } from "./_adminAuth.js";
import { DEFAULT_SETTINGS, getRestAuth, sanitizeSettings } from "./_settings.js";

const CORS = {
  "Access-Control-Allow-Headers": "Content-Type, x-admin-token, x-admin-key, authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, ...extraHeaders } });
}

async function upsertSettings(base, auth, settings) {
  return fetch(base, {
    method: "POST",
    headers: { ...auth, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ key: "global", value: settings, updated_at: new Date().toISOString() }),
  });
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return json({ error: "Service unavailable" }, 500);
  }

  const base = `${env.SUPABASE_URL}/rest/v1/system_config`;
  const auth = getRestAuth(env);

  if (request.method === "GET") {
    const res = await fetch(`${base}?key=eq.global&select=value&limit=1`, { headers: auth });
    if (!res.ok) {
      console.error("settings read failed", res.status, await res.text().catch(() => ""));
      return json(DEFAULT_SETTINGS);
    }

    const rows = await res.json().catch(() => []);
    const stored = Array.isArray(rows) && rows[0]?.value ? rows[0].value : null;

    if (!stored) {
      // Bootstrap the defaults exactly once, when the row genuinely does not
      // exist. This used to run on every GET -- a database write per visitor.
      await upsertSettings(base, auth, DEFAULT_SETTINGS).catch((err) =>
        console.error("settings bootstrap failed", err),
      );
      return json(DEFAULT_SETTINGS);
    }

    return json(sanitizeSettings({ ...DEFAULT_SETTINGS, ...stored }), 200, {
      "Cache-Control": "public, max-age=30",
    });
  }

  if (request.method === "POST") {
    if (!(await isAdminRequest(request, env))) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = await request.json().catch(() => null);
    const settings = sanitizeSettings(body);

    if (!settings.suites.length) {
      return json({ error: "At least one suite is required" }, 400);
    }

    const res = await upsertSettings(base, auth, settings);
    if (!res.ok) {
      console.error("settings save failed", res.status, await res.text().catch(() => ""));
      return json({ error: "Failed to save settings" }, 500);
    }

    return json({ ok: true, settings });
  }

  return json({ error: "Not found" }, 404);
}
