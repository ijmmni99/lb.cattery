import { getAdminSecret, getAdminTokenFromRequest, verifyAdminToken } from "./_adminAuth.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-admin-token, x-admin-key, authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Content-Type": "application/json",
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateBookingPayload(body) {
  if (!body || typeof body !== "object") return "Invalid booking payload";
  if (!DATE_PATTERN.test(body.check_in || "")) return "Invalid check-in date";
  if (!DATE_PATTERN.test(body.check_out || "")) return "Invalid check-out date";
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

  const textFields = ["owner_name", "owner_phone", "suite_type", "notes"];
  for (const field of textFields) {
    if (String(body[field] || "").length > 500) return `${field} is too long`;
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
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/system_config?key=eq.global&select=value&limit=1`, { headers: auth });
  if (!res.ok) return { suites: [], addons: [] };
  const rows = await res.json().catch(() => []);
  const value = Array.isArray(rows) && rows[0]?.value ? rows[0].value : {};
  return {
    suites: Array.isArray(value.suites) ? value.suites : [],
    addons: Array.isArray(value.addons) ? value.addons : [],
  };
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

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ADMIN_API_KEY } = env;
  const base = `${SUPABASE_URL}/rest/v1/bookings`;
  const auth = {
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
  };
  const adminRestKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  const adminAuth = {
    "apikey": adminRestKey,
    "Authorization": `Bearer ${adminRestKey}`,
    "Content-Type": "application/json",
  };

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (request.method === "GET") {
    const res = await fetch(`${base}?select=*`, { headers: auth });
    const data = await res.json();
    return new Response(JSON.stringify(data), { headers: CORS });
  }

  if (request.method === "POST") {
    const body = await request.json().catch(() => null);
    const validationError = validateBookingPayload(body);
    if (validationError) {
      return new Response(JSON.stringify({ error: validationError }), { status: 400, headers: CORS });
    }

    const payload = { ...body, status: "pending" };

    const res = await fetch(base, {
      method: "POST",
      headers: { ...auth, "Prefer": "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(payload),
    });

    if (res.ok && body.owner_email) {
      await sendAdminNewBookingEmail(env, adminAuth, payload).catch((err) =>
        console.error("sendAdminNewBookingEmail failed", err),
      );
    }

    return new Response(null, { status: res.ok ? 200 : 500, headers: CORS });
  }

  if (request.method === "PATCH" && id) {
    const adminSecret = getAdminSecret(env);
    const token = getAdminTokenFromRequest(request);
    const isTokenValid = await verifyAdminToken(token, adminSecret);

    const expectedAdminKey = ADMIN_API_KEY || SUPABASE_ANON_KEY;
    const providedKey = request.headers.get("x-admin-key") || "";
    const isLegacyKeyValid = Boolean(expectedAdminKey && providedKey === expectedAdminKey);

    if (!isTokenValid && !isLegacyKeyValid) {
      return new Response(null, { status: 401, headers: CORS });
    }

    const patchBody = await request.json().catch(() => null);
    const nextStatus = patchBody?.status;
    if (!nextStatus || !STATUS_EMAIL_SENDERS[nextStatus]) {
      return new Response(JSON.stringify({ error: "Invalid status" }), { status: 400, headers: CORS });
    }

    const currentRes = await fetch(`${base}?id=eq.${encodeURIComponent(id)}&select=*&limit=1`, { headers: adminAuth });
    const currentRows = await currentRes.json().catch(() => []);
    const currentBooking = Array.isArray(currentRows) ? currentRows[0] : null;
    if (!currentBooking) {
      return new Response(JSON.stringify({ error: "Booking not found" }), { status: 404, headers: CORS });
    }

    const allowedNextStatuses = STATUS_TRANSITIONS[currentBooking.status] || [];
    if (!allowedNextStatuses.includes(nextStatus)) {
      return new Response(JSON.stringify({ error: `Cannot move booking from ${currentBooking.status} to ${nextStatus}` }), {
        status: 400,
        headers: CORS,
      });
    }

    const res = await fetch(`${base}?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { ...adminAuth, "Prefer": "return=minimal" },
      body: JSON.stringify({ status: nextStatus }),
    });

    if (res.ok) {
      const updatedBooking = { ...currentBooking, status: nextStatus };
      await STATUS_EMAIL_SENDERS[nextStatus](env, adminAuth, updatedBooking).catch((err) =>
        console.error(`send email for status ${nextStatus} failed`, err),
      );
    }

    return new Response(null, { status: res.ok ? 200 : 500, headers: CORS });
  }

  if (request.method === "DELETE" && id) {
    const adminSecret = getAdminSecret(env);
    const token = getAdminTokenFromRequest(request);
    const isTokenValid = await verifyAdminToken(token, adminSecret);

    const expectedAdminKey = ADMIN_API_KEY || SUPABASE_ANON_KEY;
    const providedKey = request.headers.get("x-admin-key") || "";
    const isLegacyKeyValid = Boolean(expectedAdminKey && providedKey === expectedAdminKey);

    if (!isTokenValid && !isLegacyKeyValid) {
      return new Response(null, { status: 401, headers: CORS });
    }

    const res = await fetch(`${base}?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: adminAuth,
    });
    return new Response(null, { status: res.ok ? 200 : 500, headers: CORS });
  }

  return new Response("Not found", { status: 404, headers: CORS });
}
