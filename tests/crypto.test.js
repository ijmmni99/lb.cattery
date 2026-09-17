import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PBKDF2_ITERATIONS,
  generateRandomToken,
  hashPassword,
  hmacSha256,
  isModernHash,
  timingSafeEqual,
  verifyPassword,
} from "../functions/api/_crypto.js";

// Fast in tests; production uses DEFAULT_PBKDF2_ITERATIONS.
const ITER = 10_000;

/** The exact hashing the pre-migration code used, for compatibility tests. */
async function legacyHash(password, secret) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${password}.${secret}`));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

test("password hashes are salted, so identical passwords differ", async () => {
  const a = await hashPassword("hunter2hunter2", ITER);
  const b = await hashPassword("hunter2hunter2", ITER);
  assert.notEqual(a, b);
  assert.equal((await verifyPassword("hunter2hunter2", a)).valid, true);
  assert.equal((await verifyPassword("hunter2hunter2", b)).valid, true);
});

test("password hash records its own algorithm and iteration count", async () => {
  const hash = await hashPassword("hunter2hunter2", ITER);
  const [prefix, algorithm, iterations] = hash.split("$");
  assert.equal(prefix, "pbkdf2");
  assert.equal(algorithm, "sha256");
  assert.equal(Number(iterations), ITER);
  assert.equal(isModernHash(hash), true);
});

test("the default iteration count meets modern guidance", () => {
  assert.ok(DEFAULT_PBKDF2_ITERATIONS >= 200_000, "PBKDF2 iterations too low");
});

test("a wrong password is rejected", async () => {
  const hash = await hashPassword("correct-password", ITER);
  assert.equal((await verifyPassword("wrong-password", hash)).valid, false);
  assert.equal((await verifyPassword("", hash)).valid, false);
});

test("a modern hash does not depend on any environment secret", async () => {
  const hash = await hashPassword("hunter2hunter2", ITER);
  // Rotating USER_TOKEN_SECRET must not invalidate stored passwords.
  assert.equal((await verifyPassword("hunter2hunter2", hash, ["any", "secrets", "at", "all"])).valid, true);
  assert.equal((await verifyPassword("hunter2hunter2", hash, [])).valid, true);
});

test("legacy unsalted hashes still verify and are flagged for upgrade", async () => {
  const stored = await legacyHash("hunter2hunter2", "old-anon-key");

  const result = await verifyPassword("hunter2hunter2", stored, ["new-secret", "old-anon-key"]);
  assert.equal(result.valid, true);
  assert.equal(result.needsUpgrade, true);
});

test("legacy verification fails on the wrong password or an unknown secret", async () => {
  const stored = await legacyHash("hunter2hunter2", "old-anon-key");
  assert.equal((await verifyPassword("nope", stored, ["old-anon-key"])).valid, false);
  assert.equal((await verifyPassword("hunter2hunter2", stored, ["unrelated"])).valid, false);
  assert.equal((await verifyPassword("hunter2hunter2", stored, [])).valid, false);
});

test("verifyPassword handles missing or malformed stored hashes", async () => {
  for (const stored of [null, undefined, "", 42, "pbkdf2$sha256$notanumber$x$y", "pbkdf2$md5$1000$x$y"]) {
    assert.equal((await verifyPassword("whatever", stored)).valid, false, `accepted ${stored}`);
  }
});

test("verifyPassword rejects an absurd iteration count instead of hanging", async () => {
  const hostile = "pbkdf2$sha256$999999999$c2FsdA$aGFzaA";
  assert.equal((await verifyPassword("whatever", hostile)).valid, false);
});

test("hmacSha256 is deterministic and key-dependent", async () => {
  const a = await hmacSha256("payload", "secret");
  const b = await hmacSha256("payload", "secret");
  const c = await hmacSha256("payload", "other-secret");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
});

test("timingSafeEqual compares correctly across lengths and types", () => {
  assert.equal(timingSafeEqual("abc", "abc"), true);
  assert.equal(timingSafeEqual("abc", "abd"), false);
  assert.equal(timingSafeEqual("abc", "abcd"), false);
  assert.equal(timingSafeEqual("", ""), true);
  assert.equal(timingSafeEqual(null, ""), true);
  assert.equal(timingSafeEqual("abc", null), false);
});

test("generateRandomToken produces unique url-safe tokens", () => {
  const tokens = new Set();
  for (let i = 0; i < 2000; i += 1) tokens.add(generateRandomToken());
  assert.equal(tokens.size, 2000);
  for (const token of tokens) assert.match(token, /^[A-Za-z0-9_-]{43}$/);
});
