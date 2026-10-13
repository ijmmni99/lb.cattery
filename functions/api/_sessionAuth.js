import { timingSafeEqual } from "./_common.js";

function toBase64Url(input) {
  const base64 = btoa(input);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(input) {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
  return atob(base64 + pad);
}

async function sha256Base64Url(value) {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let str = "";
  for (const byte of bytes) {
    str += String.fromCharCode(byte);
  }
  return toBase64Url(str);
}

// Legacy single-round SHA-256 password hash. Kept only to verify and upgrade old rows.
export async function legacyHashPassword(password, secret) {
  return sha256Base64Url(`${password}.${secret}`);
}

// Cloudflare Workers cap PBKDF2 at 100,000 iterations in production; override with PBKDF2_ITERATIONS if your runtime allows more.
export const DEFAULT_PBKDF2_ITERATIONS = 100000;

function bytesToBase64Url(bytes) {
  let str = "";
  for (const byte of bytes) str += String.fromCharCode(byte);
  return toBase64Url(str);
}

function base64UrlToBytes(input) {
  const raw = fromBase64Url(input);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export function getPbkdf2Iterations(env) {
  const n = Number(env?.PBKDF2_ITERATIONS);
  return Number.isInteger(n) && n >= 10000 ? n : DEFAULT_PBKDF2_ITERATIONS;
}

// Returns "pbkdf2$iterations$salt$hash".
export async function hashPassword(password, env) {
  const iterations = getPbkdf2Iterations(env);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, iterations);
  return `pbkdf2$${iterations}$${bytesToBase64Url(salt)}$${bytesToBase64Url(hash)}`;
}

// Verifies a stored hash in either format. `legacySecret` is only used for old SHA-256 hashes.
// Resolves to { ok, needsUpgrade } where needsUpgrade is true for legacy hashes and for PBKDF2 hashes with fewer iterations than configured.
export async function verifyPassword(password, stored, legacySecret, env) {
  const value = String(stored || "");
  if (value.startsWith("pbkdf2$")) {
    const [, iterStr, saltB64, hashB64] = value.split("$");
    const iterations = Number(iterStr);
    if (!Number.isInteger(iterations) || iterations < 1 || !saltB64 || !hashB64) return { ok: false, needsUpgrade: false };
    const actual = bytesToBase64Url(await pbkdf2(password, base64UrlToBytes(saltB64), iterations));
    const ok = timingSafeEqual(actual, hashB64);
    return { ok, needsUpgrade: ok && iterations < getPbkdf2Iterations(env) };
  }

  if (!legacySecret) return { ok: false, needsUpgrade: false };
  const legacy = await legacyHashPassword(password, legacySecret);
  const ok = timingSafeEqual(legacy, value);
  return { ok, needsUpgrade: ok };
}

export async function hashValue(value, secret) {
  return sha256Base64Url(`${value}.${secret}`);
}

export function generateRandomToken(byteLength = 24) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let str = "";
  for (const byte of bytes) {
    str += String.fromCharCode(byte);
  }
  return toBase64Url(str);
}

export async function createSessionToken(subject, secret, ttlMs = 12 * 60 * 60 * 1000, extra = {}) {
  const payloadObj = {
    sub: subject,
    exp: Date.now() + ttlMs,
    ...extra,
  };
  const payload = toBase64Url(JSON.stringify(payloadObj));
  const signature = await sha256Base64Url(`${payload}.${secret}`);
  return `${payload}.${signature}`;
}

export async function verifySessionToken(token, secret) {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payload, signature] = parts;
  const expectedSig = await sha256Base64Url(`${payload}.${secret}`);
  if (!timingSafeEqual(signature, expectedSig)) return null;

  try {
    const raw = fromBase64Url(payload);
    const decoded = JSON.parse(raw);
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
  if (scheme?.toLowerCase() === "bearer" && token) {
    return token;
  }

  return "";
}
