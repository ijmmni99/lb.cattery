import { httpContext } from "./_http.js";

const HTTP_OPTIONS = { methods: "GET, OPTIONS", allowHeaders: "Content-Type" };

/**
 * Configuration self-check.
 *
 * Reports only whether each required setting is PRESENT -- never a value, and
 * never a hint about what a value should be. This is the same information the
 * endpoints already reveal by returning 500 with "not configured", surfaced in
 * one place so a deploy can be verified without logging in.
 */
export async function onRequest({ request, env }) {
  const http = httpContext(request, env, HTTP_OPTIONS);

  if (request.method === "OPTIONS") return http.preflight();
  if (request.method !== "GET") return http.json({ error: "Not found" }, 404);

  const checks = {
    // Required -- the site cannot serve without these.
    supabaseUrl: Boolean(env.SUPABASE_URL),
    supabaseAnonKey: Boolean(env.SUPABASE_ANON_KEY),
    supabaseServiceRoleKey: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
    adminTokenSecret: Boolean(env.ADMIN_TOKEN_SECRET),
    adminPassword: Boolean(env.ADMIN_PASSWORD),
    userTokenSecret: Boolean(env.USER_TOKEN_SECRET),
  };

  const optional = {
    resendApiKey: Boolean(env.RESEND_API_KEY),
    adminNotifyEmail: Boolean(env.ADMIN_NOTIFY_EMAIL),
    allowedOrigins: Boolean(env.ALLOWED_ORIGINS),
    legacyPasswordSecret: Boolean(env.LEGACY_PASSWORD_SECRET),
    rateLimitStore: env.RATE_LIMIT ? "kv" : "memory",
  };

  const missing = Object.entries(checks)
    .filter(([, present]) => !present)
    .map(([name]) => name);

  const warnings = [];
  if (!optional.resendApiKey) warnings.push("RESEND_API_KEY unset: no emails will be sent.");
  if (optional.rateLimitStore === "memory") {
    warnings.push("RATE_LIMIT KV namespace not bound: rate limiting falls back to per-isolate memory.");
  }

  // Degraded rather than failed: the public booking flow does not need the admin
  // or customer auth secrets, so the site still takes bookings without them.
  const publicBookingOk = checks.supabaseUrl && checks.supabaseAnonKey;

  return http.json(
    {
      ok: missing.length === 0,
      publicBookingOk,
      missing,
      checks,
      optional,
      warnings,
    },
    missing.length === 0 ? 200 : 503,
  );
}
