import { createAdminToken, getAdminSecret, getAdminTokenFromRequest, verifyAdminToken } from "./_adminAuth.js";
import { corsHeaders, json, notConfigured, rateLimit, secretsMatch } from "./_common.js";

export async function onRequest({ request, env }) {
  const cors = corsHeaders(request, env, { headers: "Content-Type, x-admin-token, authorization" });

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  const adminSecret = getAdminSecret(env);
  if (!adminSecret || !env.ADMIN_PASSWORD) return notConfigured(cors);

  if (request.method === "GET") {
    const token = getAdminTokenFromRequest(request);
    const valid = await verifyAdminToken(token, adminSecret);
    if (!valid) return json(cors, { ok: false }, 401);
    return json(cors, { ok: true });
  }

  if (request.method === "POST") {
    const limited = await rateLimit(request, env, "admin-login", cors);
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    const username = String(body?.username || "").trim();
    const password = String(body?.password || "");

    const expectedUsername = env.ADMIN_USERNAME || "admin";
    const [userOk, passOk] = await Promise.all([
      secretsMatch(username, expectedUsername),
      secretsMatch(password, env.ADMIN_PASSWORD),
    ]);

    if (!userOk || !passOk) return json(cors, { error: "Invalid credentials" }, 401);

    const token = await createAdminToken(username, adminSecret);
    return json(cors, { ok: true, token });
  }

  return json(cors, { error: "Not found" }, 404);
}
