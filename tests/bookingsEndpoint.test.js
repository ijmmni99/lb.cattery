import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { onRequest } from "../functions/api/bookings.js";
import { DEFAULT_SETTINGS } from "../functions/api/_settings.js";

const env = {
  SUPABASE_URL: "https://db.example.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  ADMIN_API_KEY: "admin-key",
  // No RESEND_API_KEY: email sending is a no-op in tests.
};

const realFetch = globalThis.fetch;
let inserted;
let overlapRows;

function stubFetch() {
  inserted = [];
  overlapRows = [];

  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    const method = options.method || "GET";

    if (href.includes("/system_config")) {
      return new Response(JSON.stringify([{ value: DEFAULT_SETTINGS }]), { status: 200 });
    }

    if (href.includes("/bookings") && method === "POST") {
      inserted.push(JSON.parse(options.body));
      return new Response(null, { status: 201 });
    }

    if (href.includes("/bookings") && method === "GET") {
      return new Response(JSON.stringify(overlapRows), { status: 200 });
    }

    throw new Error(`unexpected fetch: ${method} ${href}`);
  };
}

beforeEach(stubFetch);
afterEach(() => {
  globalThis.fetch = realFetch;
});

function post(body) {
  return onRequest({
    env,
    request: new Request("https://cattery.example/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
}

function validBody(overrides = {}) {
  return {
    owner_name: "Aisyah",
    owner_email: "Aisyah@Example.com",
    owner_phone: "0121234567",
    cats: [{ name: "Comel", breed: "Persian", age: "3" }],
    suite_type: "standard",
    check_in: "2026-03-01",
    check_out: "2026-03-05",
    add_ons: ["grooming"],
    notes: "Needs medication at 8pm",
    ...overrides,
  };
}

test("POST recomputes the total and ignores the price sent by the client", async () => {
  const res = await post(validBody({ total_price: 0 }));
  assert.equal(res.status, 201);

  const payload = await res.json();
  // 4 nights * RM20 * 1 cat + RM18 grooming
  assert.equal(payload.total_price, 98);
  assert.equal(inserted[0].total_price, 98);
});

test("POST ignores a client-supplied id and status", async () => {
  const res = await post(validBody({ id: "LB-000001", status: "confirmed" }));
  assert.equal(res.status, 201);

  const payload = await res.json();
  assert.notEqual(payload.id, "LB-000001");
  assert.match(payload.id, /^LB-[A-Z2-9]{8}$/);
  assert.equal(inserted[0].status, "pending");
  assert.equal(inserted[0].id, payload.id);
});

test("POST inserts rather than upserting, so an id can never overwrite a booking", async () => {
  let usedPrefer = "";
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes("/bookings") && (options.method || "GET") === "POST") {
      usedPrefer = options.headers?.Prefer || "";
    }
    return inner(url, options);
  };

  const res = await post(validBody());
  assert.equal(res.status, 201);
  assert.equal(usedPrefer, "return=minimal");
  assert.doesNotMatch(usedPrefer, /merge-duplicates/);
});

test("POST strips unknown columns from the payload", async () => {
  await post(validBody({ is_admin: true, secret_column: "x" }));
  assert.equal(inserted[0].is_admin, undefined);
  assert.equal(inserted[0].secret_column, undefined);
});

test("POST normalises the owner email to lowercase", async () => {
  await post(validBody());
  assert.equal(inserted[0].owner_email, "aisyah@example.com");
});

test("POST rejects a stay that exceeds the suite's cat capacity", async () => {
  // standard holds 6 cats; 5 are already booked over the range
  overlapRows = [
    { suite_type: "standard", check_in: "2026-03-02", check_out: "2026-03-04", cats: [{}, {}, {}, {}, {}] },
  ];

  const res = await post(validBody({ cats: [{ name: "A" }, { name: "B" }] }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /Only 1 space/);
  assert.equal(inserted.length, 0);
});

test("POST rejects a backwards date range", async () => {
  const res = await post(validBody({ check_in: "2026-03-10", check_out: "2026-03-02" }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /after check-in/);
  assert.equal(inserted.length, 0);
});

test("POST rejects an unknown suite", async () => {
  const res = await post(validBody({ suite_type: "penthouse" }));
  assert.equal(res.status, 409);
  assert.equal(inserted.length, 0);
});

test("POST rejects a malformed payload before touching the database", async () => {
  const res = await post(validBody({ owner_email: "not-an-email" }));
  assert.equal(res.status, 400);
  assert.equal(inserted.length, 0);
});

test("GET requires admin credentials", async () => {
  const anonymous = await onRequest({
    env,
    request: new Request("https://cattery.example/api/bookings"),
  });
  assert.equal(anonymous.status, 401);

  const asAdmin = await onRequest({
    env,
    request: new Request("https://cattery.example/api/bookings", {
      headers: { "x-admin-key": "admin-key" },
    }),
  });
  assert.equal(asAdmin.status, 200);
});

test("DELETE and PATCH require admin credentials", async () => {
  for (const method of ["PATCH", "DELETE"]) {
    const res = await onRequest({
      env,
      request: new Request("https://cattery.example/api/bookings?id=LB-ABCDEFGH", {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "PATCH" ? JSON.stringify({ status: "confirmed" }) : undefined,
      }),
    });
    assert.equal(res.status, 401, `${method} should be rejected without credentials`);
  }
});
