import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { onRequest as adminLogin } from "../functions/api/admin-login.js";
import { onRequest as userAuth } from "../functions/api/user-auth.js";
import { hashPassword } from "../functions/api/_crypto.js";
import { __resetMemoryBuckets } from "../functions/api/_rateLimit.js";

const BASE_ENV = {
  SUPABASE_URL: "https://db.example.supabase.co",
  SUPABASE_ANON_KEY: "publishable-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  ADMIN_TOKEN_SECRET: "admin-token-secret",
  ADMIN_PASSWORD: "a-real-admin-password",
  USER_TOKEN_SECRET: "user-token-secret",
  PASSWORD_HASH_ITERATIONS: "10000",
};

const realFetch = globalThis.fetch;
let users;
let patched;

beforeEach(() => {
  __resetMemoryBuckets();
  users = [];
  patched = [];

  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    const method = options.method || "GET";

    if (href.includes("/app_users") && method === "GET") {
      const match = decodeURIComponent(href).match(/email=eq\.([^&]+)/);
      const email = match ? match[1] : null;
      return new Response(JSON.stringify(users.filter((u) => !email || u.email === email)), { status: 200 });
    }
    if (href.includes("/app_users") && method === "POST") {
      users.push(JSON.parse(options.body));
      return new Response(null, { status: 201 });
    }
    if (href.includes("/app_users") && method === "PATCH") {
      patched.push(JSON.parse(options.body));
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected fetch: ${method} ${href}`);
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function req(path, { method = "POST", body, headers = {}, origin } = {}) {
  return new Request(`https://cattery.example${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(origin ? { Origin: origin } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const login = (env, body, extra) => adminLogin({ env, request: req("/api/admin-login", { body, ...extra }) });
const auth = (env, body, extra) => userAuth({ env, request: req("/api/user-auth", { body, ...extra }) });

// --- Fail-closed secrets ---

test("admin login refuses to run without ADMIN_TOKEN_SECRET", async () => {
  const { ADMIN_TOKEN_SECRET, ...env } = BASE_ENV;
  const res = await login(env, { username: "admin", password: "a-real-admin-password" });
  assert.equal(res.status, 500);
  assert.match((await res.json()).error, /not configured/);
});

test("admin login refuses to run without ADMIN_PASSWORD", async () => {
  const { ADMIN_PASSWORD, ...env } = BASE_ENV;
  const res = await login(env, { username: "admin", password: "publishable-anon-key" });
  assert.equal(res.status, 500);
});

test("the Supabase anon key is no longer an admin password", async () => {
  const res = await login(BASE_ENV, { username: "admin", password: "publishable-anon-key" });
  assert.equal(res.status, 401);
});

test("admin login succeeds with the configured password and issues a token", async () => {
  const res = await login(BASE_ENV, { username: "admin", password: "a-real-admin-password" });
  assert.equal(res.status, 200);

  const { token } = await res.json();
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  const verified = await adminLogin({
    env: BASE_ENV,
    request: req("/api/admin-login", { method: "GET", headers: { "x-admin-token": token } }),
  });
  assert.equal(verified.status, 200);
});

test("an admin token signed with the wrong secret is rejected", async () => {
  const { token } = await (await login(BASE_ENV, { username: "admin", password: "a-real-admin-password" })).json();

  const res = await adminLogin({
    env: { ...BASE_ENV, ADMIN_TOKEN_SECRET: "a-different-secret" },
    request: req("/api/admin-login", { method: "GET", headers: { "x-admin-token": token } }),
  });
  assert.equal(res.status, 401);
});

test("a tampered admin token payload is rejected", async () => {
  const { token } = await (await login(BASE_ENV, { username: "admin", password: "a-real-admin-password" })).json();
  const [, signature] = token.split(".");
  const forgedPayload = Buffer.from(JSON.stringify({ sub: "admin", role: "admin", exp: Date.now() + 1e7 }))
    .toString("base64url");

  const res = await adminLogin({
    env: BASE_ENV,
    request: req("/api/admin-login", { method: "GET", headers: { "x-admin-token": `${forgedPayload}.${signature}` } }),
  });
  assert.equal(res.status, 401);
});

test("customer auth refuses to run without USER_TOKEN_SECRET", async () => {
  const { USER_TOKEN_SECRET, ...env } = BASE_ENV;
  const res = await auth(env, { action: "login", email: "a@b.com", password: "whatever1" });
  assert.equal(res.status, 500);
  assert.match((await res.json()).error, /not configured/);
});

// --- Password storage ---

test("signup stores a salted PBKDF2 hash, never the password or a bare digest", async () => {
  const res = await auth(BASE_ENV, {
    action: "signup",
    fullName: "Aisyah",
    email: "Aisyah@Example.com",
    phone: "0121234567",
    password: "a-good-password",
  });
  assert.equal(res.status, 200);

  assert.equal(users.length, 1);
  assert.match(users[0].password_hash, /^pbkdf2\$sha256\$10000\$/);
  assert.equal(users[0].password_hash.includes("a-good-password"), false);
  assert.equal(users[0].email, "aisyah@example.com", "email should be normalised");
});

test("signup rejects short passwords and malformed emails", async () => {
  assert.equal((await auth(BASE_ENV, { action: "signup", fullName: "A", email: "a@b.com", password: "short" })).status, 400);
  assert.equal((await auth(BASE_ENV, { action: "signup", fullName: "A", email: "nope", password: "long-enough" })).status, 400);
  assert.equal(users.length, 0);
});

test("login verifies a modern hash", async () => {
  users.push({
    id: "USR-1",
    email: "aisyah@example.com",
    full_name: "Aisyah",
    password_hash: await hashPassword("a-good-password", 10000),
  });

  const ok = await auth(BASE_ENV, { action: "login", email: "aisyah@example.com", password: "a-good-password" });
  assert.equal(ok.status, 200);
  assert.ok((await ok.json()).token);

  const bad = await auth(BASE_ENV, { action: "login", email: "aisyah@example.com", password: "wrong" });
  assert.equal(bad.status, 401);
});

test("an existing customer with a legacy hash can still log in, and is upgraded", async () => {
  // A deployment that never set USER_TOKEN_SECRET hashed against the anon key.
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("a-good-password.publishable-anon-key"),
  );
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  const legacy = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

  users.push({ id: "USR-legacy", email: "old@example.com", full_name: "Old", password_hash: legacy });

  const res = await auth(BASE_ENV, { action: "login", email: "old@example.com", password: "a-good-password" });
  assert.equal(res.status, 200, "legacy customers must not be locked out");

  assert.equal(patched.length, 1, "hash should be rewritten on login");
  assert.match(patched[0].password_hash, /^pbkdf2\$sha256\$/);
});

test("login does not reveal whether an email is registered", async () => {
  users.push({ id: "USR-1", email: "known@example.com", password_hash: await hashPassword("pw-good-enough", 10000) });

  const unknown = await auth(BASE_ENV, { action: "login", email: "nobody@example.com", password: "pw-good-enough" });
  const wrongPw = await auth(BASE_ENV, { action: "login", email: "known@example.com", password: "wrong-password" });

  assert.equal(unknown.status, wrongPw.status);
  assert.deepEqual(await unknown.json(), await wrongPw.json());
});

// --- Rate limiting ---

test("admin login is rate limited per IP", async () => {
  const headers = { "CF-Connecting-IP": "203.0.113.9" };
  let last;
  for (let i = 0; i < 11; i += 1) {
    last = await login(BASE_ENV, { username: "admin", password: "guess" }, { headers });
  }
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get("Retry-After")) > 0);
});

test("the rate limit is scoped to one IP", async () => {
  for (let i = 0; i < 11; i += 1) {
    await login(BASE_ENV, { username: "admin", password: "guess" }, { headers: { "CF-Connecting-IP": "203.0.113.9" } });
  }

  const other = await login(
    BASE_ENV,
    { username: "admin", password: "a-real-admin-password" },
    { headers: { "CF-Connecting-IP": "198.51.100.4" } },
  );
  assert.equal(other.status, 200);
});

test("signup is rate limited more tightly than login", async () => {
  const headers = { "CF-Connecting-IP": "203.0.113.20" };
  let last;
  for (let i = 0; i < 6; i += 1) {
    last = await auth(
      BASE_ENV,
      { action: "signup", fullName: "A", email: `a${i}@example.com`, password: "a-good-password" },
      { headers },
    );
  }
  assert.equal(last.status, 429);
});

// --- CORS ---

test("no cross-origin access is granted by default", async () => {
  const res = await login(BASE_ENV, { username: "admin", password: "a-real-admin-password" }, {
    origin: "https://evil.example",
  });
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(res.headers.get("Vary"), "Origin");
});

test("the deployment's own origin is allowed", async () => {
  const res = await login(BASE_ENV, { username: "admin", password: "a-real-admin-password" }, {
    origin: "https://cattery.example",
  });
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://cattery.example");
});

test("extra origins can be allowlisted explicitly", async () => {
  const env = { ...BASE_ENV, ALLOWED_ORIGINS: "https://staging.cattery.example, https://preview.example" };

  const allowed = await login(env, { username: "admin", password: "a-real-admin-password" }, {
    origin: "https://staging.cattery.example",
  });
  assert.equal(allowed.headers.get("Access-Control-Allow-Origin"), "https://staging.cattery.example");

  const denied = await login(env, { username: "admin", password: "a-real-admin-password" }, {
    origin: "https://evil.example",
  });
  assert.equal(denied.headers.get("Access-Control-Allow-Origin"), null);
});

// --- Configuration self-check ---

test("health reports missing required config without leaking values", async () => {
  const { onRequest: health } = await import("../functions/api/health.js");

  const { ADMIN_PASSWORD, USER_TOKEN_SECRET, ...partial } = BASE_ENV;
  const res = await health({ env: partial, request: req("/api/health", { method: "GET" }) });
  assert.equal(res.status, 503);

  const body = await res.json();
  assert.equal(body.ok, false);
  assert.deepEqual(body.missing.sort(), ["adminPassword", "userTokenSecret"]);
  // The public booking flow does not depend on those secrets.
  assert.equal(body.publicBookingOk, true);

  // No secret values anywhere in the response.
  const serialised = JSON.stringify(body);
  for (const secret of Object.values(BASE_ENV)) {
    assert.equal(serialised.includes(secret), false, `leaked ${secret}`);
  }
});

test("health reports ok when everything required is present", async () => {
  const { onRequest: health } = await import("../functions/api/health.js");

  const res = await health({ env: BASE_ENV, request: req("/api/health", { method: "GET" }) });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.missing, []);
  assert.equal(body.optional.rateLimitStore, "memory");
  assert.ok(body.warnings.some((w) => w.includes("RATE_LIMIT")));
});
