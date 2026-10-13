import { getAdminSecret, isAdminRequest } from "./_adminAuth.js";
import { corsHeaders, json, notConfigured, rateLimit, supabaseHeaders } from "./_common.js";
import {
  addDays,
  calculateTotal,
  catCountOf,
  eachNight,
  isValidDateString,
  nightsBetween,
  todayInKualaLumpur,
} from "./_pricing.js";
import { loadSettings } from "./_settings.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Crockford base32 (no I, L, O, U). 256 is a multiple of 32, so masking a random byte is unbiased.
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function generateBookingId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let out = "LB-";
  for (const byte of bytes) out += CROCKFORD[byte & 31];
  return out;
}

function cleanText(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

// Validates the client payload shape only. Business rules (dates, capacity, suite) are checked separately.
function validateBookingPayload(body) {
  if (!body || typeof body !== "object") return "Invalid booking payload";
  if (!isValidDateString(body.check_in)) return "Invalid check-in date";
  if (!isValidDateString(body.check_out)) return "Invalid check-out date";
  if (!EMAIL_PATTERN.test(body.owner_email || "")) return "Invalid owner email";
  if (!String(body.owner_name || "").trim()) return "Owner name is required";
  if (!String(body.suite_type || "").trim()) return "Suite type is required";

  if (!Array.isArray(body.cats) || !body.cats.length) return "At least one cat is required";
  if (body.cats.length > 20) return "Too many cats on one booking";
  for (const cat of body.cats) {
    if (!cat || typeof cat !== "object" || !String(cat.name || "").trim()) return "Each cat needs a name";
    if (String(cat.name || "").length > 200) return "Cat name is too long";
    if (String(cat.breed || "").length > 200) return "Breed is too long";
  }

  if (body.add_ons !== undefined) {
    if (!Array.isArray(body.add_ons)) return "Invalid add-ons";
    if (body.add_ons.length > 20) return "Too many add-ons on one booking";
    for (const addOn of body.add_ons) {
      if (typeof addOn !== "string" || addOn.length > 100) return "Invalid add-on";
    }
  }

  const textFields = ["owner_name", "owner_phone", "suite_type", "notes", "owner_email"];
  for (const field of textFields) {
    if (String(body[field] || "").length > 500) return `${field} is too long`;
  }

  return null;
}

function sanitizeCats(cats) {
  return cats.map((cat) => {
    const clean = {
      name: cleanText(cat.name, 200),
      breed: cleanText(cat.breed, 200),
      age: cleanText(cat.age, 20),
    };
    if (typeof cat.vaccinated === "boolean") clean.vaccinated = cat.vaccinated;
    const vaccDate = cleanText(cat.vaccinationDate, 10);
    if (vaccDate && isValidDateString(vaccDate)) clean.vaccinationDate = vaccDate;
    return clean;
  });
}

// Sums cats per night for a suite across pending + confirmed bookings overlapping [checkIn, checkOut).
async function peakNightlyUsage(env, auth, suiteType, checkIn, checkOut, excludeId = null) {
  const url =
    `${env.SUPABASE_URL}/rest/v1/bookings?suite_type=eq.${encodeURIComponent(suiteType)}` +
    `&check_in=lt.${checkOut}&check_out=gt.${checkIn}` +
    `&or=(status.is.null,status.in.(pending,confirmed))&select=id,check_in,check_out,cats,cat_name&limit=5000`;
  const res = await fetch(url, { headers: auth });
  if (!res.ok) throw new Error(`capacity lookup failed: ${res.status}`);
  const rows = await res.json();

  const usage = new Map(eachNight(checkIn, checkOut).map((night) => [night, 0]));
  for (const row of rows) {
    if (excludeId && row.id === excludeId) continue;
    const cats = catCountOf(row);
    for (const night of usage.keys()) {
      if (night >= row.check_in && night < row.check_out) usage.set(night, usage.get(night) + cats);
    }
  }
  return usage;
}

function firstFullNight(usage, newCats, capacity) {
  for (const [night, used] of usage) {
    if (used + newCats > capacity) return night;
  }
  return null;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

async function lookupNames(env, auth) {
  const { settings } = await loadSettings(env, auth);
  return { suites: settings.suites, addons: settings.addons };
}

async function sendEmail(env, { to, subject, html }) {
  if (!env.RESEND_API_KEY) return;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL || "L&B Cattery <onboarding@resend.dev>",
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("sendEmail failed", subject, res.status, detail);
  }
}

async function buildBookingSummary(env, auth, booking) {
  const { suites, addons } = await lookupNames(env, auth);
  const suite = suites.find((s) => s.code === booking.suite_type);
  const cats = Array.isArray(booking.cats) ? booking.cats : [];
  const catNames = cats.map((cat) => cat.name).filter(Boolean).join(", ") || "your cat";
  const addOnCodes = Array.isArray(booking.add_ons) ? booking.add_ons : [];
  const addOnNames = addOnCodes.map((code) => addons.find((a) => a.code === code)?.name).filter(Boolean).join(", ");
  const formattedTotal = new Intl.NumberFormat("ms-MY", {
    style: "currency",
    currency: "MYR",
    maximumFractionDigits: 2,
  }).format(Number(booking.total_price) || 0);

  return {
    catNames,
    suiteName: suite ? suite.name : booking.suite_type,
    addOnNames: addOnNames || "None",
    formattedTotal,
  };
}

async function sendAdminNewBookingEmail(env, auth, booking) {
  if (!env.ADMIN_NOTIFY_EMAIL) return;
  const { catNames, suiteName, addOnNames, formattedTotal } = await buildBookingSummary(env, auth, booking);

  await sendEmail(env, {
    to: env.ADMIN_NOTIFY_EMAIL,
    subject: `New booking pending review - ${booking.id}`,
    html: `
      <p>A new booking was submitted and needs review.</p>
      <ul>
        <li>Booking ID: <strong>${escapeHtml(booking.id)}</strong></li>
        <li>Owner: ${escapeHtml(booking.owner_name)} (${escapeHtml(booking.owner_email)}, ${escapeHtml(booking.owner_phone || "-")})</li>
        <li>Cats: ${escapeHtml(catNames)}</li>
        <li>Suite: ${escapeHtml(suiteName)}</li>
        <li>Add-ons: ${escapeHtml(addOnNames)}</li>
        <li>Stay: ${escapeHtml(booking.check_in)} to ${escapeHtml(booking.check_out)}</li>
        <li>Total: ${formattedTotal}</li>
      </ul>
      <p>Approve or reject this booking in the admin backend.</p>
    `,
  });
}

async function sendBookingConfirmationEmail(env, auth, booking) {
  const { catNames, suiteName, addOnNames, formattedTotal } = await buildBookingSummary(env, auth, booking);

  await sendEmail(env, {
    to: booking.owner_email,
    subject: `Booking confirmed - ${booking.id}`,
    html: `
      <p>Hi ${escapeHtml(booking.owner_name) || "there"},</p>
      <p>Your reservation for <strong>${escapeHtml(catNames)}</strong> is confirmed.</p>
      <ul>
        <li>Booking ID: <strong>${escapeHtml(booking.id)}</strong></li>
        <li>Suite: ${escapeHtml(suiteName)}</li>
        <li>Add-ons: ${escapeHtml(addOnNames)}</li>
        <li>Stay: ${escapeHtml(booking.check_in)} to ${escapeHtml(booking.check_out)}</li>
        <li>Total: ${formattedTotal}</li>
      </ul>
      <p>Keep your booking ID handy. You can look up this booking anytime using your email and booking ID, or create an account with this same email address to view all your bookings in one place.</p>
    `,
  });
}

async function sendBookingRejectedEmail(env, auth, booking) {
  const { catNames } = await buildBookingSummary(env, auth, booking);

  await sendEmail(env, {
    to: booking.owner_email,
    subject: `Booking not approved - ${booking.id}`,
    html: `
      <p>Hi ${escapeHtml(booking.owner_name) || "there"},</p>
      <p>Unfortunately we're unable to accommodate your reservation for <strong>${escapeHtml(catNames)}</strong> (Booking ID: ${escapeHtml(booking.id)}) for the requested dates.</p>
      <p>Please contact us if you'd like to try different dates or have any questions.</p>
    `,
  });
}

async function sendBookingCompletedEmail(env, auth, booking) {
  const { catNames } = await buildBookingSummary(env, auth, booking);
  const html = `
    <p>Hi ${escapeHtml(booking.owner_name) || "there"},</p>
    <p>The stay for <strong>${escapeHtml(catNames)}</strong> (Booking ID: ${escapeHtml(booking.id)}) has been marked as completed.</p>
    <p>Thank you for staying with us — we hope to see you again soon!</p>
  `;

  await sendEmail(env, { to: booking.owner_email, subject: `Stay completed - ${booking.id}`, html });
  if (env.ADMIN_NOTIFY_EMAIL) {
    await sendEmail(env, {
      to: env.ADMIN_NOTIFY_EMAIL,
      subject: `Booking marked completed - ${booking.id}`,
      html: `<p>Booking ${escapeHtml(booking.id)} for ${escapeHtml(booking.owner_name)} was marked completed.</p>`,
    });
  }
}

const STATUS_TRANSITIONS = {
  pending: ["confirmed", "rejected"],
  confirmed: ["completed"],
};

const STATUS_EMAIL_SENDERS = {
  confirmed: sendBookingConfirmationEmail,
  rejected: sendBookingRejectedEmail,
  completed: sendBookingCompletedEmail,
};

const PUBLIC_CALENDAR_LOOKBACK_DAYS = 90;

async function handlePublicList(env, auth, cors) {
  const since = addDays(todayInKualaLumpur(), -PUBLIC_CALENDAR_LOOKBACK_DAYS);
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/bookings?select=suite_type,check_in,check_out,cats,cat_name,status` +
      `&or=(status.is.null,status.not.in.(rejected,cancelled))&check_out=gte.${since}&limit=5000`,
    { headers: auth },
  );
  if (!res.ok) return json(cors, { error: "Failed to load availability" }, 500);

  const rows = await res.json();
  return json(
    cors,
    rows.map((row) => ({
      suite_type: row.suite_type,
      check_in: row.check_in,
      check_out: row.check_out,
      cats: catCountOf(row),
      status: row.status || "pending",
    })),
  );
}

async function handleCreate(request, env, auth, cors) {
  const limited = await rateLimit(request, env, "bookings-post", cors);
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const validationError = validateBookingPayload(body);
  if (validationError) return json(cors, { error: validationError }, 400);

  const { settings, ok } = await loadSettings(env, auth);
  if (!ok) return json(cors, { error: "Could not load booking settings" }, 500);

  if (settings.booking.allowPublicBooking === false) {
    return json(cors, { error: "Bookings are currently closed." }, 403);
  }

  const suite = settings.suites.find((s) => s.code === body.suite_type && s.active);
  if (!suite) return json(cors, { error: "Selected suite is not available" }, 400);

  const addOns = [...new Set(body.add_ons || [])];
  for (const code of addOns) {
    if (!settings.addons.some((a) => a.code === code && a.active)) {
      return json(cors, { error: `Add-on "${cleanText(code, 50)}" is not available` }, 400);
    }
  }

  const checkIn = body.check_in;
  const checkOut = body.check_out;
  if (checkOut <= checkIn) return json(cors, { error: "Check-out date must be after check-in date" }, 400);
  if (checkIn < todayInKualaLumpur()) return json(cors, { error: "Check-in date cannot be in the past" }, 400);

  const nights = nightsBetween(checkIn, checkOut);
  if (nights < settings.booking.minNights) {
    return json(cors, { error: `Minimum stay is ${settings.booking.minNights} night(s)` }, 400);
  }
  if (nights > settings.booking.maxNights) {
    return json(cors, { error: `Maximum stay is ${settings.booking.maxNights} night(s)` }, 400);
  }

  const cats = sanitizeCats(body.cats);

  let usage;
  try {
    usage = await peakNightlyUsage(env, auth, suite.code, checkIn, checkOut);
  } catch (err) {
    console.error(err);
    return json(cors, { error: "Could not check availability" }, 500);
  }
  const fullNight = firstFullNight(usage, cats.length, suite.capacity);
  if (fullNight) {
    return json(cors, { error: `${suite.name} is fully booked on ${fullNight} for ${cats.length} cat(s). Please choose other dates or another suite.` }, 409);
  }

  const totalPrice = calculateTotal(settings, {
    suiteType: suite.code,
    checkIn,
    checkOut,
    addOns,
    catCount: cats.length,
  });

  // The client never controls id, status or total_price. Plain insert (no merge); retry on the unlikely id collision.
  let booking = null;
  for (let attempt = 0; attempt < 3 && !booking; attempt += 1) {
    const candidate = {
      id: generateBookingId(),
      owner_name: cleanText(body.owner_name, 200),
      owner_email: cleanText(body.owner_email, 254).toLowerCase(),
      owner_phone: cleanText(body.owner_phone, 50) || null,
      cats,
      suite_type: suite.code,
      check_in: checkIn,
      check_out: checkOut,
      add_ons: addOns,
      total_price: totalPrice,
      notes: cleanText(body.notes, 500) || null,
      status: "pending",
    };

    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/bookings`, {
      method: "POST",
      headers: { ...auth, Prefer: "return=minimal" },
      body: JSON.stringify(candidate),
    });

    if (res.ok) {
      booking = candidate;
    } else if (res.status !== 409) {
      console.error("insert booking failed", res.status, await res.text().catch(() => ""));
      return json(cors, { error: "Could not save booking" }, 500);
    }
  }
  if (!booking) return json(cors, { error: "Could not save booking" }, 500);

  // Concurrent requests can both pass the check above. Re-count including our row and back out if we overshot.
  try {
    const after = await peakNightlyUsage(env, auth, suite.code, checkIn, checkOut);
    if (firstFullNight(after, 0, suite.capacity)) {
      await fetch(`${env.SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(booking.id)}`, { method: "DELETE", headers: auth });
      return json(cors, { error: `${suite.name} just filled up for those dates. Please choose other dates.` }, 409);
    }
  } catch (err) {
    console.error("post-insert capacity check failed", err);
  }

  await sendAdminNewBookingEmail(env, auth, booking).catch((err) => console.error("sendAdminNewBookingEmail failed", err));

  return json(cors, { id: booking.id, status: booking.status, total_price: booking.total_price }, 201);
}

async function requireAdmin(request, env, cors) {
  if (!getAdminSecret(env)) return notConfigured(cors);
  if (!(await isAdminRequest(request, env))) return json(cors, { error: "Unauthorized" }, 401);
  return null;
}

export async function onRequest({ request, env }) {
  const cors = corsHeaders(request, env, {
    methods: "GET, POST, PATCH, DELETE, OPTIONS",
    headers: "Content-Type, x-admin-token, authorization",
  });

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  const auth = supabaseHeaders(env);
  if (!auth) return notConfigured(cors);

  const base = `${env.SUPABASE_URL}/rest/v1/bookings`;
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (request.method === "GET") {
    if (searchParams.get("scope") === "admin") {
      const denied = await requireAdmin(request, env, cors);
      if (denied) return denied;
      const res = await fetch(`${base}?select=*&order=created_at.desc`, { headers: auth });
      if (!res.ok) return json(cors, { error: "Failed to load bookings" }, 500);
      return json(cors, await res.json());
    }
    return handlePublicList(env, auth, cors);
  }

  if (request.method === "POST") {
    return handleCreate(request, env, auth, cors);
  }

  if (request.method === "PATCH" && id) {
    const denied = await requireAdmin(request, env, cors);
    if (denied) return denied;

    const patchBody = await request.json().catch(() => null);
    const nextStatus = patchBody?.status;
    if (!nextStatus || !STATUS_EMAIL_SENDERS[nextStatus]) {
      return json(cors, { error: "Invalid status" }, 400);
    }

    const currentRes = await fetch(`${base}?id=eq.${encodeURIComponent(id)}&select=*&limit=1`, { headers: auth });
    const currentRows = await currentRes.json().catch(() => []);
    const currentBooking = Array.isArray(currentRows) ? currentRows[0] : null;
    if (!currentBooking) return json(cors, { error: "Booking not found" }, 404);

    const allowedNextStatuses = STATUS_TRANSITIONS[currentBooking.status] || [];
    if (!allowedNextStatuses.includes(nextStatus)) {
      return json(cors, { error: `Cannot move booking from ${currentBooking.status} to ${nextStatus}` }, 400);
    }

    const res = await fetch(`${base}?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { ...auth, Prefer: "return=minimal" },
      body: JSON.stringify({ status: nextStatus }),
    });

    if (res.ok) {
      const updatedBooking = { ...currentBooking, status: nextStatus };
      await STATUS_EMAIL_SENDERS[nextStatus](env, auth, updatedBooking).catch((err) =>
        console.error(`send email for status ${nextStatus} failed`, err),
      );
    }

    return new Response(null, { status: res.ok ? 200 : 500, headers: cors });
  }

  if (request.method === "DELETE" && id) {
    const denied = await requireAdmin(request, env, cors);
    if (denied) return denied;

    const res = await fetch(`${base}?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: auth });
    return new Response(null, { status: res.ok ? 200 : 500, headers: cors });
  }

  return json(cors, { error: "Not found" }, 404);
}
