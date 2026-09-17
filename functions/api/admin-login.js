import { createAdminToken, getAdminSecret, getAdminTokenFromRequest, verifyAdminToken } from "./_adminAuth.js";
import { timingSafeEqual } from "./_crypto.js";
import { httpContext } from "./_http.js";
import { clientIp, enforceRateLimit } from "./_rateLimit.js";

const HTTP_OPTIONS = {
  methods: "GET, POST, OPTIONS",
  allowHeaders: "Content-Type, x-admin-token, authorization",
};

export async function onRequest({ request, env }) {
  const http = httpContext(request, env, HTTP_OPTIONS);

  if (request.method === "OPTIONS") return http.preflight();

  const adminSecret = getAdminSecret(env);
  const adminPassword = env.ADMIN_PASSWORD || "";

  // Fail closed. Previously both of these fell back to SUPABASE_ANON_KEY, so a
  // deployment that set neither had an admin password equal to a publishable key.
  if (!adminSecret || !adminPassword) {
    console.error(
      "Admin auth is not configured: set ADMIN_TOKEN_SECRET and ADMIN_PASSWORD. " +
        "Falling back to SUPABASE_ANON_KEY is no longer supported.",
    );
    return http.json({ error: "Admin auth is not configured." }, 500);
  }

  if (request.method === "GET") {
    const valid = await verifyAdminToken(getAdminTokenFromRequest(request), adminSecret);
    return valid ? http.json({ ok: true }) : http.json({ ok: false }, 401);
  }

  if (request.method === "POST") {
    const limited = await enforceRateLimit(env, http, {
      key: `admin-login:${clientIp(request)}`,
      limit: 10,
      windowSeconds: 15 * 60,
      message: "Too many sign-in attempts. Please wait a few minutes and try again.",
    });
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    const username = String(body?.username || "").trim();
    const password = String(body?.password || "");

    // Both comparisons run regardless of whether the first fails, so the response
    // time does not reveal which half of the credentials was wrong.
    const usernameOk = timingSafeEqual(username, env.ADMIN_USERNAME || "admin");
    const passwordOk = timingSafeEqual(password, adminPassword);

    if (!usernameOk || !passwordOk) {
      return http.json({ error: "Invalid credentials" }, 401);
    }

    return http.json({ ok: true, token: await createAdminToken(username, adminSecret) });
  }

  return http.json({ error: "Not found" }, 404);
}
