import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { onRequest } from "../functions/api/availability.js";

const env = {
  SUPABASE_URL: "https://db.example.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
};

const realFetch = globalThis.fetch;
let requestedUrl = "";

beforeEach(() => {
  requestedUrl = "";
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(
      JSON.stringify([
        {
          suite_type: "standard",
          check_in: "2026-03-01",
          check_out: "2026-03-05",
          cats: [{ name: "Comel" }, { name: "Tompok" }],
          // Columns the query does not ask for, included here to prove the
          // handler never forwards them even if the database returns them.
          owner_name: "Aisyah",
          owner_email: "aisyah@example.com",
          owner_phone: "0121234567",
          notes: "Medication at 8pm",
          total_price: 160,
        },
      ]),
      { status: 200 },
    );
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function get(query = "") {
  return onRequest({ env, request: new Request(`https://cattery.example/api/availability${query}`) });
}

test("the public feed exposes occupancy without any personal data", async () => {
  const res = await get();
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.deepEqual(body.occupancy, [
    { suiteType: "standard", checkIn: "2026-03-01", checkOut: "2026-03-05", cats: 2 },
  ]);

  const serialised = JSON.stringify(body);
  for (const secret of ["Aisyah", "aisyah@example.com", "0121234567", "Medication", "Comel", "160"]) {
    assert.equal(serialised.includes(secret), false, `leaked ${secret}`);
  }
});

test("the feed only selects non-identifying columns and occupied statuses", async () => {
  await get();
  assert.match(requestedUrl, /select=suite_type,check_in,check_out,cats/);
  assert.match(requestedUrl, /status=in\.\(pending,confirmed,completed\)/);
  assert.equal(requestedUrl.includes("owner_email"), false);
  assert.equal(requestedUrl.includes("select=\*"), false);
});

test("the feed honours a valid date window and ignores a malformed one", async () => {
  const res = await get("?from=2026-03-01&to=2026-03-31");
  assert.deepEqual(await res.json().then((b) => [b.from, b.to]), ["2026-03-01", "2026-03-31"]);

  const fallback = await get("?from=garbage&to=2025-02-31");
  const body = await fallback.json();
  assert.match(body.from, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(body.to, /^\d{4}-\d{2}-\d{2}$/);
  assert.notEqual(body.to, "2025-02-31");
});

test("non-GET methods are rejected", async () => {
  const res = await onRequest({
    env,
    request: new Request("https://cattery.example/api/availability", { method: "POST" }),
  });
  assert.equal(res.status, 404);
});
