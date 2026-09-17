/**
 * Password hashing, token signing and constant-time comparison.
 *
 * Two things changed from the original implementation and both matter:
 *
 * 1. Passwords were a single unsalted SHA-256 over `password + "." + secret`.
 *    Identical passwords produced identical hashes and the whole table was
 *    GPU-crackable. They are now PBKDF2-HMAC-SHA256 with a per-user random salt.
 * 2. Password hashes no longer depend on any environment secret, so rotating
 *    USER_TOKEN_SECRET can never again lock every customer out of their account.
 */

const encoder = new TextEncoder();

export const DEFAULT_PBKDF2_ITERATIONS = 210_000;
const PBKDF2_PREFIX = "pbkdf2";
const SALT_BYTES = 16;
const KEY_BITS = 256;

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
  const binary = atob(base64 + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encodeBase64Url(text) {
  return toBase64Url(encoder.encode(text));
}

export function decodeBase64Url(value) {
  return new TextDecoder().decode(fromBase64Url(value));
}

/**
 * Comparison whose duration does not depend on where the first difference is.
 * A plain `!==` on a secret leaks its prefix through timing.
 */
export function timingSafeEqual(a, b) {
  const aBytes = encoder.encode(String(a ?? ""));
  const bBytes = encoder.encode(String(b ?? ""));
  // Compare a fixed-width digest of each side so differing lengths do not
  // short-circuit, then confirm the lengths separately.
  let diff = aBytes.length ^ bBytes.length;
  const max = Math.max(aBytes.length, bBytes.length);
  for (let i = 0; i < max; i += 1) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

/** Produces `pbkdf2$sha256$<iterations>$<salt>$<hash>`. Self-contained: no env secret. */
export async function hashPassword(password, iterations = DEFAULT_PBKDF2_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await pbkdf2(password, salt, iterations);
  return [PBKDF2_PREFIX, "sha256", iterations, toBase64Url(salt), toBase64Url(derived)].join("$");
}

export function isModernHash(stored) {
  return typeof stored === "string" && stored.startsWith(`${PBKDF2_PREFIX}$`);
}

async function verifyModern(password, stored) {
  const [, algorithm, iterationsRaw, saltRaw, expected] = stored.split("$");
  if (algorithm !== "sha256") return false;

  const iterations = Number(iterationsRaw);
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 5_000_000) return false;

  const derived = await pbkdf2(password, fromBase64Url(saltRaw), iterations);
  return timingSafeEqual(toBase64Url(derived), expected);
}

async function legacySha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toBase64Url(new Uint8Array(digest));
}

/**
 * Verifies a password against either hash format.
 *
 * `legacySecrets` are the candidate secrets that pre-migration hashes may have
 * been salted with. Several are tried because the original code silently fell
 * back from USER_TOKEN_SECRET to SUPABASE_ANON_KEY, so a deployment that never
 * set the former has hashes keyed to the latter.
 *
 * Returns `{ valid, needsUpgrade }`. A legacy hash that verifies should be
 * rewritten in the modern format by the caller.
 */
export async function verifyPassword(password, stored, legacySecrets = []) {
  if (!stored || typeof stored !== "string") return { valid: false, needsUpgrade: false };

  if (isModernHash(stored)) {
    return { valid: await verifyModern(password, stored), needsUpgrade: false };
  }

  for (const secret of legacySecrets.filter(Boolean)) {
    if (timingSafeEqual(await legacySha256(`${password}.${secret}`), stored)) {
      return { valid: true, needsUpgrade: true };
    }
  }

  return { valid: false, needsUpgrade: false };
}

/** HMAC-SHA256, replacing the hand-rolled `sha256(payload + secret)` construction. */
export async function hmacSha256(message, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return toBase64Url(new Uint8Array(signature));
}

/** Opaque random token, e.g. for password resets. */
export function generateRandomToken(byteLength = 32) {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

/** One-way digest of a bearer token, so a database leak does not expose live tokens. */
export async function hashToken(value, secret) {
  return hmacSha256(value, secret);
}
