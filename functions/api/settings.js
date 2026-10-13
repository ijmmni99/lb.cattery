import { getAdminSecret, isAdminRequest } from "./_adminAuth.js";
import { corsHeaders, json, notConfigured, supabaseHeaders } from "./_common.js";
import { loadSettings, sanitizeSettings } from "./_settings.js";

export async function onRequest({ request, env }) {
  const cors = corsHeaders(request, env, { headers: "Content-Type, x-admin-token, authorization" });

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  const auth = supabaseHeaders(env);
  if (!auth) return notConfigured(cors);

  const base = `${env.SUPABASE_URL}/rest/v1/system_config`;

  if (request.method === "GET") {
    const { settings, exists, ok } = await loadSettings(env, auth);

    // Auto-bootstrap the default row once, if the table exists but no record has been created yet.
    if (ok && !exists) {
      await fetch(base, {
        method: "POST",
        headers: { ...auth, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ key: "global", value: settings, updated_at: new Date().toISOString() }),
      }).catch(() => null);
    }

    return json(cors, settings);
  }

  if (request.method === "POST") {
    if (!getAdminSecret(env)) return notConfigured(cors);
    if (!(await isAdminRequest(request, env))) return json(cors, { error: "Unauthorized" }, 401);

    const body = await request.json().catch(() => null);
    const settings = sanitizeSettings(body);

    const res = await fetch(base, {
      method: "POST",
      headers: { ...auth, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ key: "global", value: settings, updated_at: new Date().toISOString() }),
    });

    if (!res.ok) {
      console.error("save settings failed", res.status, await res.text().catch(() => ""));
      return json(cors, { error: "Failed to save settings" }, 500);
    }

    return json(cors, { ok: true });
  }

  return json(cors, { error: "Not found" }, 404);
}
