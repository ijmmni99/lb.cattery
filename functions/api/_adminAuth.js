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

export async function createAdminToken(username, secret, ttlMs = 12 * 60 * 60 * 1000) {
  const payloadObj = {
    sub: username,
    exp: Date.now() + ttlMs,
  };
  const payload = toBase64Url(JSON.stringify(payloadObj));
  const signature = await sha256Base64Url(`${payload}.${secret}`);
  return `${payload}.${signature}`;
}

export async function verifyAdminToken(token, secret) {
  if (!token || !secret) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;

  const [payload, signature] = parts;
  const expectedSig = await sha256Base64Url(`${payload}.${secret}`);
  if (signature !== expectedSig) return false;

  try {
    const raw = fromBase64Url(payload);
    const decoded = JSON.parse(raw);
    if (!decoded.exp || Number(decoded.exp) < Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

export function getAdminTokenFromRequest(request) {
  const headerToken = request.headers.get("x-admin-token");
  if (headerToken) return headerToken;

  const authHeader = request.headers.get("authorization") || "";
  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() === "bearer" && token) {
    return token;
  }

  return "";
}

export function getAdminSecret(env) {
  return env.ADMIN_TOKEN_SECRET || env.ADMIN_API_KEY || env.SUPABASE_ANON_KEY || "";
}
