export const DEFAULT_SETTINGS = {
  booking: {
    allowPublicBooking: true,
    minNights: 1,
    maxNights: 30,
  },
  suites: [
    { code: "standard", name: "Standard Suite", nightlyRate: 20, capacity: 6, imageUrl: "", active: true },
    { code: "deluxe", name: "Deluxe Suite", nightlyRate: 35, capacity: 4, imageUrl: "", active: true },
    { code: "royal", name: "Royal Suite", nightlyRate: 55, capacity: 2, imageUrl: "", active: true },
  ],
  addons: [
    { code: "grooming", name: "Grooming Package", flatFee: 18, nightlyFee: 0, active: true },
    { code: "playtime", name: "Extended Playtime", flatFee: 0, nightlyFee: 10, active: true },
    { code: "medication", name: "Medication Support", flatFee: 12, nightlyFee: 0, active: true },
  ],
  promos: [],
};

// Only these schemes may appear in admin-supplied image/link URLs. Anything else
// (notably javascript:) is dropped so a compromised admin session cannot store XSS.
const SAFE_URL_PATTERN = /^(https?:\/\/|\/|\.{0,2}\/|[\w-]+\/)/i;

export function sanitizeUrl(value) {
  const url = String(value || "").trim().slice(0, 2000);
  if (!url) return "";
  return SAFE_URL_PATTERN.test(url) ? url : "";
}

export function sanitizeSettings(input) {
  const safe = input && typeof input === "object" ? input : {};
  const booking = safe.booking && typeof safe.booking === "object" ? safe.booking : {};

  const suites = Array.isArray(safe.suites) ? safe.suites : [];
  const addons = Array.isArray(safe.addons) ? safe.addons : [];
  const promos = Array.isArray(safe.promos) ? safe.promos : [];

  const minNights = Number(booking.minNights) > 0 ? Math.floor(Number(booking.minNights)) : 1;
  const maxNights = Number(booking.maxNights) > 0 ? Math.floor(Number(booking.maxNights)) : 30;

  return {
    booking: {
      allowPublicBooking: booking.allowPublicBooking !== false,
      minNights,
      maxNights: Math.max(minNights, maxNights),
    },
    suites: suites
      .map((suite) => ({
        code: String(suite.code || "").trim(),
        name: String(suite.name || "").trim(),
        nightlyRate: Number(suite.nightlyRate) || 0,
        // Capacity is the number of CAT SLOTS the suite holds, not the number of
        // bookings; pricing is per cat per night, so availability counts cats too.
        capacity: Math.max(1, Math.floor(Number(suite.capacity) || 1)),
        imageUrl: sanitizeUrl(suite.imageUrl),
        active: suite.active !== false,
      }))
      .filter((suite) => suite.code && suite.name),
    addons: addons
      .map((addon) => ({
        code: String(addon.code || "").trim(),
        name: String(addon.name || "").trim(),
        flatFee: Number(addon.flatFee) || 0,
        nightlyFee: Number(addon.nightlyFee) || 0,
        active: addon.active !== false,
      }))
      .filter((addon) => addon.code && addon.name),
    promos: promos
      .map((promo) => ({
        imageUrl: sanitizeUrl(promo.imageUrl),
        caption: String(promo.caption || "").trim().slice(0, 200),
        linkUrl: sanitizeUrl(promo.linkUrl),
        active: promo.active !== false,
      }))
      .filter((promo) => promo.imageUrl),
  };
}

export function getRestAuth(env) {
  const restKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
  return {
    apikey: restKey,
    Authorization: `Bearer ${restKey}`,
    "Content-Type": "application/json",
  };
}

/** Reads the `global` settings row. Never writes -- callers must not mutate on read. */
export async function readSettings(env, headers = getRestAuth(env)) {
  const base = `${env.SUPABASE_URL}/rest/v1/system_config`;
  const res = await fetch(`${base}?key=eq.global&select=value&limit=1`, { headers });
  if (!res.ok) return DEFAULT_SETTINGS;

  const rows = await res.json().catch(() => []);
  if (!Array.isArray(rows) || rows.length === 0 || !rows[0].value) return DEFAULT_SETTINGS;

  return sanitizeSettings({ ...DEFAULT_SETTINGS, ...rows[0].value });
}
