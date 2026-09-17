import { decodeBase64Url, encodeBase64Url, hmacSha256, timingSafeEqual } from "./_crypto.js";

export { generateRandomToken, hashPassword, hashToken, verifyPassword } from "./_crypto.js";

/**
 * Secret used to sign customer session tokens.
 *
 * Returns "" when unset. It deliberately does NOT fall back to SUPABASE_ANON_KEY:
 * the anon key is a publishable credential, so signing sessions with it meant
 * anyone holding it could mint valid tokens. Callers must fail closed.
 */
export function getUserSecret(env) {
  return env.USER_TOKEN_SECRET || "";
}

/**
 * Candidate secrets that a pre-migration password hash may have been salted
 * with. The old code fell back from USER_TOKEN_SECRET to SUPABASE_ANON_KEY, so
 * a deployment that never set the former has hashes keyed to the latter. All
 * candidates are tried when verifying a legacy hash, which is then upgraded.
 */
export function getLegacyPasswordSecrets(env) {
  return [env.LEGACY_PASSWORD_SECRET, env.USER_TOKEN_SECRET, env.SUPABASE_ANON_KEY].filter(Boolean);
}

export async function createSessionToken(subject, secret, ttlMs = 12 * 60 * 60 * 1000, extra = {}) {
  const payload = encodeBase64Url(JSON.stringify({ sub: subject, exp: Date.now() + ttlMs, ...extra }));
  return `${payload}.${await hmacSha256(payload, secret)}`;
}

export async function verifySessionToken(token, secret) {
  if (!token || !secret) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payload, signature] = parts;
  if (!timingSafeEqual(signature, await hmacSha256(payload, secret))) return null;

  try {
    const decoded = JSON.parse(decodeBase64Url(payload));
    if (!decoded.exp || Number(decoded.exp) < Date.now()) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function getTokenFromRequest(request, headerName = "x-user-token") {
  const headerToken = request.headers.get(headerName);
  if (headerToken) return headerToken;

  const authHeader = request.headers.get("authorization") || "";
  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() === "bearer" && token) return token;

  return "";
}
