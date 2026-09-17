/**
 * Server-side booking rules. The browser runs the same checks for fast feedback,
 * but these are the ones that actually decide whether a booking is accepted --
 * never trust the client for availability, pricing, or stay limits.
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MS_PER_DAY = 86400000;

/** Statuses that occupy a suite. Rejected/cancelled bookings must not block dates. */
export const OCCUPYING_STATUSES = ["pending", "confirmed", "completed"];

export function isValidDate(iso) {
  if (!DATE_PATTERN.test(iso || "")) return false;
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function toUtcTime(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

export function nightsBetween(checkIn, checkOut) {
  return Math.round((toUtcTime(checkOut) - toUtcTime(checkIn)) / MS_PER_DAY);
}

export function datesOverlap(aStart, aEnd, bStart, bEnd) {
  return toUtcTime(aStart) < toUtcTime(bEnd) && toUtcTime(aEnd) > toUtcTime(bStart);
}

export function countCats(booking) {
  return Array.isArray(booking?.cats) ? Math.max(1, booking.cats.length) : 1;
}

/**
 * Authoritative price. `total_price` sent by the browser is display-only and is
 * always discarded in favour of this.
 */
export function calculateTotal(settings, { suiteType, addOnCodes = [], checkIn, checkOut, catCount }) {
  const nights = Math.max(0, nightsBetween(checkIn, checkOut));
  const suite = settings.suites.find((s) => s.code === suiteType && s.active);
  if (!suite) return 0;

  const suiteTotal = suite.nightlyRate * nights * Math.max(1, catCount);
  const addonsTotal = addOnCodes.reduce((sum, code) => {
    const addon = settings.addons.find((a) => a.code === code && a.active);
    if (!addon) return sum;
    return sum + (addon.flatFee || 0) + (addon.nightlyFee || 0) * nights;
  }, 0);

  return Math.round((suiteTotal + addonsTotal) * 100) / 100;
}

/** Cat slots already taken in `suiteType` over the requested range. */
export function catsBookedInRange(bookings, suiteType, checkIn, checkOut) {
  return bookings
    .filter((booking) => booking.suite_type === suiteType)
    .filter((booking) => datesOverlap(checkIn, checkOut, booking.check_in, booking.check_out))
    .reduce((sum, booking) => sum + countCats(booking), 0);
}

/**
 * Shape/type validation of the submitted payload. Returns an error string or null.
 * Business rules (dates, capacity, pricing) are validated separately against settings.
 */
export function validateBookingPayload(body) {
  if (!body || typeof body !== "object") return "Invalid booking payload";
  if (!isValidDate(body.check_in)) return "Invalid check-in date";
  if (!isValidDate(body.check_out)) return "Invalid check-out date";
  if (!EMAIL_PATTERN.test(body.owner_email || "")) return "Invalid owner email";
  if (String(body.owner_email).length > 320) return "Owner email is too long";
  if (!String(body.owner_name || "").trim()) return "Owner name is required";
  if (!String(body.suite_type || "").trim()) return "Suite type is required";

  if (!Array.isArray(body.cats) || !body.cats.length) return "At least one cat is required";
  if (body.cats.length > 20) return "Too many cats on one booking";
  for (const cat of body.cats) {
    if (!cat || typeof cat !== "object" || !String(cat.name || "").trim()) return "Each cat needs a name";
    if (String(cat.name || "").length > 200) return "Cat name is too long";
    if (String(cat.breed || "").length > 200) return "Breed is too long";
    if (String(cat.age ?? "").length > 20) return "Age is too long";
  }

  if (body.add_ons !== undefined) {
    if (!Array.isArray(body.add_ons)) return "Invalid add-ons";
    if (body.add_ons.length > 20) return "Too many add-ons on one booking";
    for (const addOn of body.add_ons) {
      if (typeof addOn !== "string" || addOn.length > 100) return "Invalid add-on";
    }
  }

  for (const field of ["owner_name", "owner_phone", "suite_type", "notes"]) {
    if (String(body[field] || "").length > 500) return `${field.replace(/_/g, " ")} is too long`;
  }

  return null;
}

/**
 * Business rules that depend on admin settings. `bookedCats` is the number of cat
 * slots already occupied in the requested suite and range.
 */
export function validateBookingRules(settings, booking, bookedCats) {
  if (settings.booking.allowPublicBooking === false) {
    return "Bookings are currently closed.";
  }

  const nights = nightsBetween(booking.check_in, booking.check_out);
  if (nights <= 0) return "Check-out date must be after check-in date.";
  if (nights < settings.booking.minNights) {
    return `Minimum stay is ${settings.booking.minNights} night(s).`;
  }
  if (nights > settings.booking.maxNights) {
    return `Maximum stay is ${settings.booking.maxNights} night(s).`;
  }

  const suite = settings.suites.find((s) => s.code === booking.suite_type && s.active);
  if (!suite) return "That suite is not available.";

  const addOnCodes = Array.isArray(booking.add_ons) ? booking.add_ons : [];
  for (const code of addOnCodes) {
    if (!settings.addons.some((addon) => addon.code === code && addon.active)) {
      return "One or more selected add-ons are unavailable.";
    }
  }
  if (new Set(addOnCodes).size !== addOnCodes.length) return "Duplicate add-ons selected.";

  const catCount = countCats(booking);
  if (bookedCats + catCount > suite.capacity) {
    const free = Math.max(0, suite.capacity - bookedCats);
    return free === 0
      ? "Those dates are fully booked for this suite."
      : `Only ${free} space(s) left in this suite for those dates.`;
  }

  return null;
}

const ID_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I/L/O/0/1 -- read aloud over the phone

/**
 * Collision-resistant, human-readable booking reference. The old scheme used the
 * last 6 digits of Date.now(), which repeats every ~16.7 minutes.
 */
export function generateBookingId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let id = "";
  for (const byte of bytes) id += ID_ALPHABET[byte % ID_ALPHABET.length];
  return `LB-${id}`;
}
