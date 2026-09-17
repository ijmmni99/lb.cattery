import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateTotal,
  catsBookedInRange,
  countCats,
  datesOverlap,
  generateBookingId,
  isValidDate,
  nightsBetween,
  validateBookingPayload,
  validateBookingRules,
} from "../functions/api/_bookingRules.js";
import { DEFAULT_SETTINGS, sanitizeSettings, sanitizeUrl } from "../functions/api/_settings.js";

const settings = sanitizeSettings(DEFAULT_SETTINGS);

function booking(overrides = {}) {
  return {
    owner_name: "Aisyah",
    owner_email: "aisyah@example.com",
    owner_phone: "0121234567",
    cats: [{ name: "Comel", breed: "Persian", age: "3" }],
    suite_type: "standard",
    check_in: "2026-03-01",
    check_out: "2026-03-05",
    add_ons: [],
    ...overrides,
  };
}

test("isValidDate rejects impossible calendar dates", () => {
  assert.equal(isValidDate("2026-02-28"), true);
  assert.equal(isValidDate("2025-02-31"), false);
  assert.equal(isValidDate("2026-13-01"), false);
  assert.equal(isValidDate("2026-3-1"), false);
  assert.equal(isValidDate(""), false);
  assert.equal(isValidDate(null), false);
});

test("nightsBetween counts nights, not days", () => {
  assert.equal(nightsBetween("2026-03-01", "2026-03-05"), 4);
  assert.equal(nightsBetween("2026-03-01", "2026-03-02"), 1);
  assert.equal(nightsBetween("2026-03-01", "2026-03-01"), 0);
});

test("nightsBetween is unaffected by daylight-saving style offsets", () => {
  assert.equal(nightsBetween("2026-03-28", "2026-03-30"), 2);
  assert.equal(nightsBetween("2026-10-24", "2026-10-26"), 2);
});

test("datesOverlap treats back-to-back stays as non-overlapping", () => {
  assert.equal(datesOverlap("2026-03-01", "2026-03-05", "2026-03-05", "2026-03-08"), false);
  assert.equal(datesOverlap("2026-03-01", "2026-03-05", "2026-03-04", "2026-03-08"), true);
  assert.equal(datesOverlap("2026-03-01", "2026-03-05", "2026-02-20", "2026-03-01"), false);
});

test("capacity is measured in cat slots, not bookings", () => {
  const existing = [
    { suite_type: "standard", check_in: "2026-03-01", check_out: "2026-03-05", cats: [{}, {}, {}] },
    { suite_type: "standard", check_in: "2026-03-02", check_out: "2026-03-03", cats: [{}, {}] },
    { suite_type: "deluxe", check_in: "2026-03-01", check_out: "2026-03-05", cats: [{}, {}] },
  ];
  assert.equal(catsBookedInRange(existing, "standard", "2026-03-01", "2026-03-05"), 5);
  assert.equal(catsBookedInRange(existing, "deluxe", "2026-03-01", "2026-03-05"), 2);
  assert.equal(catsBookedInRange(existing, "standard", "2026-04-01", "2026-04-05"), 0);
});

test("countCats defaults to one for legacy single-cat rows", () => {
  assert.equal(countCats({ cats: [{}, {}] }), 2);
  assert.equal(countCats({ cats: [] }), 1);
  assert.equal(countCats({}), 1);
});

test("calculateTotal charges per cat per night plus add-on fees", () => {
  // standard = RM20/night, 4 nights, 2 cats = 160
  // grooming = RM18 flat, playtime = RM10/night * 4 = 40
  const total = calculateTotal(settings, {
    suiteType: "standard",
    addOnCodes: ["grooming", "playtime"],
    checkIn: "2026-03-01",
    checkOut: "2026-03-05",
    catCount: 2,
  });
  assert.equal(total, 160 + 18 + 40);
});

test("calculateTotal ignores unknown or inactive add-ons", () => {
  const total = calculateTotal(settings, {
    suiteType: "standard",
    addOnCodes: ["does-not-exist"],
    checkIn: "2026-03-01",
    checkOut: "2026-03-02",
    catCount: 1,
  });
  assert.equal(total, 20);
});

test("calculateTotal returns zero for an unknown suite", () => {
  const total = calculateTotal(settings, {
    suiteType: "penthouse",
    checkIn: "2026-03-01",
    checkOut: "2026-03-05",
    catCount: 1,
  });
  assert.equal(total, 0);
});

test("payload validation rejects malformed submissions", () => {
  assert.equal(validateBookingPayload(booking()), null);
  assert.match(validateBookingPayload(booking({ check_in: "not-a-date" })), /check-in/);
  assert.match(validateBookingPayload(booking({ owner_email: "nope" })), /email/);
  assert.match(validateBookingPayload(booking({ owner_name: "   " })), /Owner name/);
  assert.match(validateBookingPayload(booking({ cats: [] })), /at least one cat/i);
  assert.match(validateBookingPayload(booking({ cats: [{ breed: "Persian" }] })), /needs a name/);
  assert.match(validateBookingPayload(booking({ add_ons: "grooming" })), /add-ons/i);
  assert.match(validateBookingPayload(booking({ notes: "x".repeat(501) })), /too long/);
  assert.match(validateBookingPayload(null), /Invalid booking payload/);
});

test("business rules reject a backwards or zero-length stay", () => {
  const backwards = booking({ check_in: "2026-03-05", check_out: "2026-03-01" });
  assert.match(validateBookingRules(settings, backwards, 0), /after check-in/);

  const sameDay = booking({ check_in: "2026-03-01", check_out: "2026-03-01" });
  assert.match(validateBookingRules(settings, sameDay, 0), /after check-in/);
});

test("business rules enforce the configured stay length", () => {
  const strict = sanitizeSettings({ ...DEFAULT_SETTINGS, booking: { minNights: 2, maxNights: 5 } });
  assert.match(
    validateBookingRules(strict, booking({ check_in: "2026-03-01", check_out: "2026-03-02" }), 0),
    /Minimum stay is 2/,
  );
  assert.match(
    validateBookingRules(strict, booking({ check_in: "2026-03-01", check_out: "2026-03-20" }), 0),
    /Maximum stay is 5/,
  );
  assert.equal(validateBookingRules(strict, booking(), 0), null);
});

test("business rules refuse bookings while booking is closed", () => {
  const closed = sanitizeSettings({ ...DEFAULT_SETTINGS, booking: { allowPublicBooking: false } });
  assert.match(validateBookingRules(closed, booking(), 0), /closed/);
});

test("business rules reject unknown suites and add-ons", () => {
  assert.match(validateBookingRules(settings, booking({ suite_type: "penthouse" }), 0), /not available/);
  assert.match(validateBookingRules(settings, booking({ add_ons: ["massage"] }), 0), /unavailable/);
  assert.match(validateBookingRules(settings, booking({ add_ons: ["grooming", "grooming"] }), 0), /Duplicate/);
});

test("business rules enforce cat-slot capacity", () => {
  // standard capacity is 6 cats
  const twoCats = booking({ cats: [{ name: "A" }, { name: "B" }] });
  assert.equal(validateBookingRules(settings, twoCats, 4), null);
  assert.match(validateBookingRules(settings, twoCats, 5), /Only 1 space/);
  assert.match(validateBookingRules(settings, twoCats, 6), /fully booked/);
});

test("generateBookingId avoids collisions and ambiguous characters", () => {
  const ids = new Set();
  for (let i = 0; i < 5000; i += 1) ids.add(generateBookingId());
  assert.equal(ids.size, 5000);
  for (const id of ids) assert.match(id, /^LB-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
});

test("sanitizeUrl strips javascript: and other unsafe schemes", () => {
  assert.equal(sanitizeUrl("https://example.com/cat.jpg"), "https://example.com/cat.jpg");
  assert.equal(sanitizeUrl("assets/promo.jpg"), "assets/promo.jpg");
  assert.equal(sanitizeUrl("/assets/promo.jpg"), "/assets/promo.jpg");
  assert.equal(sanitizeUrl("./promo.jpg"), "./promo.jpg");
  assert.equal(sanitizeUrl("javascript:alert(1)"), "");
  assert.equal(sanitizeUrl("  JavaScript:alert(1)  "), "");
  assert.equal(sanitizeUrl("data:text/html;base64,PHNjcmlwdD4="), "");
  assert.equal(sanitizeUrl(""), "");
});

test("sanitizeSettings clamps maxNights below minNights", () => {
  const out = sanitizeSettings({ booking: { minNights: 5, maxNights: 2 }, suites: DEFAULT_SETTINGS.suites });
  assert.equal(out.booking.minNights, 5);
  assert.equal(out.booking.maxNights, 5);
});

test("sanitizeSettings drops incomplete suites and add-ons", () => {
  const out = sanitizeSettings({
    suites: [{ code: "ok", name: "Fine" }, { code: "", name: "No code" }, { code: "x", name: "" }],
    addons: [{ code: "a", name: "A" }, { code: "b" }],
  });
  assert.equal(out.suites.length, 1);
  assert.equal(out.addons.length, 1);
  assert.equal(out.suites[0].capacity, 1);
});
