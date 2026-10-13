// Single source of truth for stay maths and pricing. Mirrors calculateEstimate in script.js.

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateString(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function nightsBetween(checkIn, checkOut) {
  const ms = Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

// Today's date (YYYY-MM-DD) in Asia/Kuala_Lumpur.
export function todayInKualaLumpur(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDays(dateString, days) {
  const d = new Date(`${dateString}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function eachNight(checkIn, checkOut) {
  const nights = [];
  for (let d = checkIn; d < checkOut; d = addDays(d, 1)) nights.push(d);
  return nights;
}

export function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

// suite nightlyRate x nights x cats + sum(addon flatFee + nightlyFee x nights)
export function calculateTotal(settings, { suiteType, checkIn, checkOut, addOns = [], catCount = 1 }) {
  const nights = Math.max(0, nightsBetween(checkIn, checkOut));
  const suite = settings.suites.find((s) => s.code === suiteType && s.active);
  if (!suite) return 0;

  const suiteTotal = suite.nightlyRate * nights * Math.max(1, catCount);
  const addonsTotal = addOns.reduce((sum, code) => {
    const addon = settings.addons.find((a) => a.code === code && a.active);
    if (!addon) return sum;
    return sum + (addon.flatFee || 0) + (addon.nightlyFee || 0) * nights;
  }, 0);

  return round2(suiteTotal + addonsTotal);
}

export function catCountOf(row) {
  if (Array.isArray(row.cats) && row.cats.length) return row.cats.length;
  return 1; // legacy rows (cat_name column) held a single cat
}
