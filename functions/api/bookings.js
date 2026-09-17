import { isAdminRequest } from "./_adminAuth.js";
import { getRestAuth, readSettings } from "./_settings.js";
import {
  OCCUPYING_STATUSES,
  calculateTotal,
  catsBookedInRange,
  countCats,
  generateBookingId,
  validateBookingPayload,
  validateBookingRules,
} from "./_bookingRules.js";

const CORS = {
  "Access-Control-Allow-Headers": "Content-Type, x-admin-token, x-admin-key, authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

function json(body, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: CORS });
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

function formatMoney(value) {
  return new Intl.NumberFormat("ms-MY", {
    style: "currency",
    currency: "MYR",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function buildBookingSummary(settings, booking) {
  const suite = settings.suites.find((s) => s.code === booking.suite_type);
  const cats = Array.isArray(booking.cats) ? booking.cats : [];
  const addOnCodes = Array.isArray(booking.add_ons) ? booking.add_ons : [];
  const addOnNames = addOnCodes
    .map((code) => settings.addons.find((a) => a.code === code)?.name)
    .filter(Boolean)
    .join(", ");

  return {
    catNames: cats.map((cat) => cat.name).filter(Boolean).join(", ") || "your cat",
    suiteName: suite ? suite.name : booking.suite_type,
    addOnNames: addOnNames || "None",
    formattedTotal: formatMoney(booking.total_price),
  };
}

function detailList(summary, booking) {
  return `
      <ul>
        <li>Booking ID: <strong>${escapeHtml(booking.id)}</strong></li>
        <li>Suite: ${escapeHtml(summary.suiteName)}</li>
        <li>Cats: ${escapeHtml(summary.catNames)}</li>
        <li>Add-ons: ${escapeHtml(summary.addOnNames)}</li>
        <li>Stay: ${escapeHtml(booking.check_in)} to ${escapeHtml(booking.check_out)}</li>
        <li>Total: ${escapeHtml(summary.formattedTotal)}</li>
      </ul>`;
}

async function sendBookingReceivedEmails(env, settings, booking) {
  const summary = buildBookingSummary(settings, booking);

  await sendEmail(env, {
    to: booking.owner_email,
    subject: `We received your booking request - ${booking.id}`,
    html: `
      <p>Hi ${escapeHtml(booking.owner_name) || "there"},</p>
      <p>Thanks for your reservation request. It is now <strong>pending review</strong> and we will email you again as soon as it is confirmed.</p>
      ${detailList(summary, booking)}
      <p>Keep your booking ID handy -- you can look up this booking anytime using your email and booking ID.</p>
    `,
  });

  if (env.ADMIN_NOTIFY_EMAIL) {
    await sendEmail(env, {
      to: env.ADMIN_NOTIFY_EMAIL,
      subject: `New booking pending review - ${booking.id}`,
      html: `
        <p>A new booking was submitted and needs review.</p>
        <p>Owner: ${escapeHtml(booking.owner_name)} (${escapeHtml(booking.owner_email)}, ${escapeHtml(booking.owner_phone || "-")})</p>
        ${detailList(summary, booking)}
        <p>Approve or reject this booking in the admin backend.</p>
      `,
    });
  }
}

async function sendBookingConfirmationEmail(env, settings, booking) {
  const summary = buildBookingSummary(settings, booking);
  await sendEmail(env, {
    to: booking.owner_email,
    subject: `Booking confirmed - ${booking.id}`,
    html: `
      <p>Hi ${escapeHtml(booking.owner_name) || "there"},</p>
      <p>Your reservation for <strong>${escapeHtml(summary.catNames)}</strong> is confirmed.</p>
      ${detailList(summary, booking)}
      <p>Keep your booking ID handy. You can look up this booking anytime using your email and booking ID, or create an account with this same email address to view all your bookings in one place.</p>
    `,
  });
}

async function sendBookingRejectedEmail(env, settings, booking) {
  const summary = buildBookingSummary(settings, booking);
  await sendEmail(env, {
    to: booking.owner_email,
    subject: `Booking not approved - ${booking.id}`,
    html: `
      <p>Hi ${escapeHtml(booking.owner_name) || "there"},</p>
      <p>Unfortunately we're unable to accommodate your reservation for <strong>${escapeHtml(summary.catNames)}</strong> (Booking ID: ${escapeHtml(booking.id)}) for the requested dates.</p>
      <p>Please contact us if you'd like to try different dates or have any questions.</p>
    `,
  });
}

async function sendBookingCompletedEmail(env, settings, booking) {
  const summary = buildBookingSummary(settings, booking);
  await sendEmail(env, {
    to: booking.owner_email,
    subject: `Stay completed - ${booking.id}`,
    html: `
      <p>Hi ${escapeHtml(booking.owner_name) || "there"},</p>
      <p>The stay for <strong>${escapeHtml(summary.catNames)}</strong> (Booking ID: ${escapeHtml(booking.id)}) has been marked as completed.</p>
      <p>Thank you for staying with us -- we hope to see you again soon!</p>
    `,
  });

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

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return json({ error: "Service unavailable" }, 500);
  }

  const base = `${env.SUPABASE_URL}/rest/v1/bookings`;
  const auth = getRestAuth(env);
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  // Full booking records contain owner names, emails, phone numbers and care
  // notes, so every read of this endpoint is admin-only. Public pages use
  // /api/availability, which exposes occupancy without personal data.
  if (request.method === "GET") {
    if (!(await isAdminRequest(request, env))) {
      return json({ error: "Unauthorized" }, 401);
    }

    const res = await fetch(`${base}?select=*&order=check_in.asc`, { headers: auth });
    if (!res.ok) {
      console.error("bookings list failed", res.status, await res.text().catch(() => ""));
      return json({ error: "Failed to load bookings" }, 500);
    }

    return json(await res.json());
  }

  if (request.method === "POST") {
    const body = await request.json().catch(() => null);

    const validationError = validateBookingPayload(body);
    if (validationError) {
      return json({ error: validationError }, 400);
    }

    const settings = await readSettings(env, auth);
    const addOns = Array.isArray(body.add_ons) ? body.add_ons : [];

    // Capacity is counted in cat slots across bookings that actually occupy the
    // suite; rejected bookings no longer block dates.
    const overlapQuery = [
      `select=suite_type,check_in,check_out,cats`,
      `suite_type=eq.${encodeURIComponent(body.suite_type)}`,
      `status=in.(${OCCUPYING_STATUSES.join(",")})`,
      `check_in=lt.${encodeURIComponent(body.check_out)}`,
      `check_out=gt.${encodeURIComponent(body.check_in)}`,
    ].join("&");

    const overlapRes = await fetch(`${base}?${overlapQuery}`, { headers: auth });
    if (!overlapRes.ok) {
      console.error("overlap query failed", overlapRes.status, await overlapRes.text().catch(() => ""));
      return json({ error: "Could not verify availability. Please try again." }, 500);
    }

    const overlapping = await overlapRes.json().catch(() => []);
    const bookedCats = catsBookedInRange(
      Array.isArray(overlapping) ? overlapping : [],
      body.suite_type,
      body.check_in,
      body.check_out,
    );

    const ruleError = validateBookingRules(settings, body, bookedCats);
    if (ruleError) {
      return json({ error: ruleError }, 409);
    }

    // Build the row explicitly: the client must not be able to set arbitrary
    // columns, the booking id, the status, or the price.
    const booking = {
      id: generateBookingId(),
      owner_name: String(body.owner_name).trim(),
      owner_email: String(body.owner_email).trim().toLowerCase(),
      owner_phone: String(body.owner_phone || "").trim() || null,
      cats: body.cats.map((cat) => ({
        name: String(cat.name || "").trim(),
        breed: String(cat.breed || "").trim(),
        age: String(cat.age ?? "").trim(),
      })),
      suite_type: body.suite_type,
      check_in: body.check_in,
      check_out: body.check_out,
      add_ons: addOns,
      total_price: calculateTotal(settings, {
        suiteType: body.suite_type,
        addOnCodes: addOns,
        checkIn: body.check_in,
        checkOut: body.check_out,
        catCount: countCats(body),
      }),
      notes: String(body.notes || "").trim() || null,
      status: "pending",
      created_at: new Date().toISOString(),
    };

    // A plain insert, not an upsert: a duplicate id must fail loudly rather than
    // silently overwrite somebody else's reservation.
    const res = await fetch(base, {
      method: "POST",
      headers: { ...auth, Prefer: "return=minimal" },
      body: JSON.stringify(booking),
    });

    if (!res.ok) {
      console.error("booking insert failed", res.status, await res.text().catch(() => ""));
      return json({ error: "Could not save your booking. Please try again." }, 500);
    }

    await sendBookingReceivedEmails(env, settings, booking).catch((err) =>
      console.error("sendBookingReceivedEmails failed", err),
    );

    return json({ ok: true, id: booking.id, total_price: booking.total_price, status: booking.status }, 201);
  }

  if (request.method === "PATCH" && id) {
    if (!(await isAdminRequest(request, env))) {
      return json({ error: "Unauthorized" }, 401);
    }

    const patchBody = await request.json().catch(() => null);
    const nextStatus = patchBody?.status;
    if (!nextStatus || !STATUS_EMAIL_SENDERS[nextStatus]) {
      return json({ error: "Invalid status" }, 400);
    }

    const currentRes = await fetch(`${base}?id=eq.${encodeURIComponent(id)}&select=*&limit=1`, { headers: auth });
    const currentRows = await currentRes.json().catch(() => []);
    const currentBooking = Array.isArray(currentRows) ? currentRows[0] : null;
    if (!currentBooking) {
      return json({ error: "Booking not found" }, 404);
    }

    const allowedNextStatuses = STATUS_TRANSITIONS[currentBooking.status] || [];
    if (!allowedNextStatuses.includes(nextStatus)) {
      return json({ error: `Cannot move booking from ${currentBooking.status} to ${nextStatus}` }, 400);
    }

    const res = await fetch(`${base}?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { ...auth, Prefer: "return=minimal" },
      body: JSON.stringify({ status: nextStatus }),
    });

    if (!res.ok) {
      console.error("booking status update failed", res.status, await res.text().catch(() => ""));
      return json({ error: "Failed to update booking" }, 500);
    }

    const settings = await readSettings(env, auth);
    await STATUS_EMAIL_SENDERS[nextStatus](env, settings, { ...currentBooking, status: nextStatus }).catch((err) =>
      console.error(`send email for status ${nextStatus} failed`, err),
    );

    return json({ ok: true, id, status: nextStatus });
  }

  if (request.method === "DELETE" && id) {
    if (!(await isAdminRequest(request, env))) {
      return json({ error: "Unauthorized" }, 401);
    }

    const res = await fetch(`${base}?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: auth });
    if (!res.ok) {
      console.error("booking delete failed", res.status, await res.text().catch(() => ""));
      return json({ error: "Failed to delete booking" }, 500);
    }

    return json({ ok: true, id });
  }

  return json({ error: "Not found" }, 404);
}
