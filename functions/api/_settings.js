// Settings defaults, sanitising and loading. Shared by settings.js and bookings.js.

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

export function sanitizeSettings(input) {
  const safe = input && typeof input === "object" ? input : {};
  const booking = safe.booking && typeof safe.booking === "object" ? safe.booking : {};

  const suites = Array.isArray(safe.suites) ? safe.suites : [];
  const addons = Array.isArray(safe.addons) ? safe.addons : [];
  const promos = Array.isArray(safe.promos) ? safe.promos : [];

  return {
    booking: {
      allowPublicBooking: booking.allowPublicBooking !== false,
      minNights: Number(booking.minNights) > 0 ? Number(booking.minNights) : 1,
      maxNights: Number(booking.maxNights) > 0 ? Number(booking.maxNights) : 30,
    },
    suites: suites
      .map((suite) => ({
        code: String(suite.code || "").trim(),
        name: String(suite.name || "").trim(),
        nightlyRate: Number(suite.nightlyRate) || 0,
        capacity: Math.max(1, Number(suite.capacity) || 1),
        imageUrl: String(suite.imageUrl || "").trim().slice(0, 2000),
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
        imageUrl: String(promo.imageUrl || "").trim().slice(0, 2000),
        caption: String(promo.caption || "").trim().slice(0, 200),
        linkUrl: String(promo.linkUrl || "").trim().slice(0, 2000),
        active: promo.active !== false,
      }))
      .filter((promo) => promo.imageUrl),
  };
}

// Returns { settings, exists }. Falls back to defaults when the row is missing or unreadable.
export async function loadSettings(env, headers) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/system_config?key=eq.global&select=value&limit=1`, { headers });
  if (!res.ok) return { settings: sanitizeSettings(DEFAULT_SETTINGS), exists: true, ok: false };

  const rows = await res.json().catch(() => []);
  if (!Array.isArray(rows) || rows.length === 0 || !rows[0].value) {
    return { settings: sanitizeSettings(DEFAULT_SETTINGS), exists: false, ok: true };
  }

  return { settings: sanitizeSettings({ ...DEFAULT_SETTINGS, ...rows[0].value }), exists: true, ok: true };
}
