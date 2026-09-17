import { decodeBase64Url, encodeBase64Url, hmacSha256, timingSafeEqual } from "./_crypto.js";

/**
 * Secret used to sign admin session tokens.
 *
 * Returns "" when ADMIN_TOKEN_SECRET is unset. The previous fallback chain ended
 * at SUPABASE_ANON_KEY -- a publishable credential -- which meant anyone holding
 * the anon key could forge an admin session. Callers must fail closed.
 */
export function getAdminSecret(env) {
  return env.ADMIN_TOKEN_SECRET || "";
}

export async function createAdminToken(username, secret, ttlMs = 12 * 60 * 60 * 1000) {
  const payload = encodeBase64Url(JSON.stringify({ sub: username, role: "admin", exp: Date.now() + ttlMs }));
  return `${payload}.${await hmacSha256(payload, secret)}`;
}

export async function verifyAdminToken(token, secret) {
  if (!token || !secret) return false;

  const parts = token.split(".");
  if (parts.length !== 2) return false;

  const [payload, signature] = parts;
  if (!timingSafeEqual(signature, await hmacSha256(payload, secret))) return false;

  try {
    const decoded = JSON.parse(decodeBase64Url(payload));
    return Boolean(decoded.exp) && Number(decoded.exp) >= Date.now();
  } catch {
    return false;
  }
}

export function getAdminTokenFromRequest(request) {
  const headerToken = request.headers.get("x-admin-token");
  if (headerToken) return headerToken;

  const authHeader = request.headers.get("authorization") || "";
  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() === "bearer" && token) return token;

  return "";
}

/**
 * True when the request carries a valid admin session token, or the legacy
 * x-admin-key header. The legacy key must be set explicitly as ADMIN_API_KEY --
 * it no longer falls back to the anon key -- and is compared in constant time.
 */
export async function isAdminRequest(request, env) {
  const secret = getAdminSecret(env);
  if (secret && (await verifyAdminToken(getAdminTokenFromRequest(request), secret))) return true;

  const expectedAdminKey = env.ADMIN_API_KEY || "";
  const providedKey = request.headers.get("x-admin-key") || "";
  return Boolean(expectedAdminKey && providedKey && timingSafeEqual(providedKey, expectedAdminKey));
}
