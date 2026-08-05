const DEFAULT_SETTINGS = {
  booking: {
    allowPublicBooking: true,
    minNights: 1,
    maxNights: 30,
  },
  suites: [
    { code: "standard", name: "Standard Suite", nightlyRate: 20, capacity: 6, active: true },
    { code: "deluxe", name: "Deluxe Suite", nightlyRate: 35, capacity: 4, active: true },
    { code: "royal", name: "Royal Suite", nightlyRate: 55, capacity: 2, active: true },
  ],
  addons: [
    { code: "none", name: "No add-on", flatFee: 0, nightlyFee: 0, active: true },
    { code: "grooming", name: "Grooming Package", flatFee: 18, nightlyFee: 0, active: true },
    { code: "playtime", name: "Extended Playtime", flatFee: 0, nightlyFee: 10, active: true },
    { code: "medication", name: "Medication Support", flatFee: 12, nightlyFee: 0, active: true },
  ],
};

const bookingForm = document.getElementById("booking-form");
const estimatedTotalEl = document.getElementById("estimated-total");
const availabilityStart = document.getElementById("availability-start");
const availabilityEnd = document.getElementById("availability-end");
const availabilitySuite = document.getElementById("availability-suite");
const availabilityResult = document.getElementById("availability-result");
const checkAvailabilityBtn = document.getElementById("check-availability");
const blockedRangesEl = document.getElementById("blocked-ranges");
const calendarTitleEl = document.getElementById("calendar-title");
const calendarEl = document.getElementById("availability-calendar");
const calPrevBtn = document.getElementById("cal-prev");
const calNextBtn = document.getElementById("cal-next");
const formModeEl = document.getElementById("form-mode");
const suiteSelect = bookingForm.elements.namedItem("suiteType");
const addOnSelect = bookingForm.elements.namedItem("addOn");
const priceGuideEl = document.getElementById("price-guide");
const accountMenuBtn = document.getElementById("account-menu-btn");
const accountMenu = document.getElementById("account-menu");
const stepIndicatorEl = document.getElementById("step-indicator");
const stepEls = Array.from(document.querySelectorAll(".form-step"));
const stepBackBtn = document.getElementById("step-back");
const stepNextBtn = document.getElementById("step-next");
const submitBookingBtn = document.getElementById("submit-booking");
const bookingSummaryEl = document.getElementById("booking-summary");
const pricePanelEl = document.querySelector("#booking-card .price-panel");
const mobileLayoutQuery = window.matchMedia("(max-width: 900px)");

const STEP_LABELS = ["Suite & Dates", "Cat Details", "Contact Info", "Review & Confirm"];
let currentStep = 0;

const calendarState = {
  year: new Date().getFullYear(),
  month: new Date().getMonth(),
};

let settings = structuredClone(DEFAULT_SETTINGS);

function toggleAccountMenu(forceOpen = null) {
  if (!accountMenu || !accountMenuBtn) return;
  const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : accountMenu.hidden;
  accountMenu.hidden = !shouldOpen;
  accountMenuBtn.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
}

if (accountMenuBtn && accountMenu) {
  accountMenuBtn.addEventListener("click", () => {
    toggleAccountMenu();
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (accountMenu.contains(target) || accountMenuBtn.contains(target)) return;
    toggleAccountMenu(false);
  });
}

function parseDate(dateString) {
  return new Date(`${dateString}T00:00:00`);
}

function daysBetween(startDate, endDate) {
  const ms = parseDate(endDate) - parseDate(startDate);
  return Math.ceil(ms / 86400000);
}

function formatMoney(value) {
  return new Intl.NumberFormat("ms-MY", {
    style: "currency",
    currency: "MYR",
    maximumFractionDigits: 2,
  }).format(value);
}

function suiteByCode(code) {
  return settings.suites.find((suite) => suite.code === code && suite.active);
}

function addonByCode(code) {
  return settings.addons.find((addon) => addon.code === code && addon.active);
}

function getSuiteCapacityMap() {
  return Object.fromEntries(settings.suites.filter((suite) => suite.active).map((suite) => [suite.code, Number(suite.capacity) || 1]));
}

async function getBookings() {
  const res = await fetch("/api/bookings");
  if (!res.ok) {
    console.error("getBookings failed", res.status);
    return [];
  }
  const data = await res.json();
  return data.map((r) => ({
    id: r.id,
    ownerName: r.owner_name,
    ownerEmail: r.owner_email,
    ownerPhone: r.owner_phone,
    catName: r.cat_name,
    breed: r.breed,
    age: r.age,
    suiteType: r.suite_type,
    checkIn: r.check_in,
    checkOut: r.check_out,
    addOn: r.add_on,
    totalPrice: r.total_price,
    notes: r.notes,
  }));
}

async function saveBooking(booking) {
  const res = await fetch("/api/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: booking.id,
      owner_name: booking.ownerName,
      owner_email: booking.ownerEmail,
      owner_phone: booking.ownerPhone,
      cat_name: booking.catName,
      breed: booking.breed,
      age: booking.age,
      suite_type: booking.suiteType,
      check_in: booking.checkIn,
      check_out: booking.checkOut,
      add_on: booking.addOn,
      total_price: booking.totalPrice,
      notes: booking.notes || null,
    }),
  });
  if (!res.ok) {
    console.error("saveBooking failed", res.status);
    throw new Error("Booking save failed");
  }
}

async function getSettings() {
  const res = await fetch("/api/settings");
  if (!res.ok) return structuredClone(DEFAULT_SETTINGS);
  const data = await res.json();
  return normalizeSettings(data);
}

function normalizeSettings(raw) {
  const safe = raw && typeof raw === "object" ? raw : {};
  const booking = safe.booking && typeof safe.booking === "object" ? safe.booking : {};

  const suites = Array.isArray(safe.suites) ? safe.suites : DEFAULT_SETTINGS.suites;
  const addons = Array.isArray(safe.addons) ? safe.addons : DEFAULT_SETTINGS.addons;

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
  };
}

function renderSelectOptions() {
  const suiteOptions = settings.suites.filter((suite) => suite.active);
  suiteSelect.innerHTML = "";
  availabilitySuite.innerHTML = "";

  suiteOptions.forEach((suite) => {
    const optionA = document.createElement("option");
    optionA.value = suite.code;
    optionA.textContent = suite.name;
    suiteSelect.appendChild(optionA);

    const optionB = document.createElement("option");
    optionB.value = suite.code;
    optionB.textContent = suite.name;
    availabilitySuite.appendChild(optionB);
  });

  const addonOptions = settings.addons.filter((addon) => addon.active);
  addOnSelect.innerHTML = "";
  addonOptions.forEach((addon) => {
    const option = document.createElement("option");
    option.value = addon.code;
    option.textContent = addon.name;
    addOnSelect.appendChild(option);
  });
}

function renderPriceGuide() {
  const suiteItems = settings.suites
    .filter((suite) => suite.active)
    .map((suite) => `<li>${suite.name}: ${formatMoney(suite.nightlyRate)} per night (Capacity: ${suite.capacity})</li>`);
  const addonItems = settings.addons
    .filter((addon) => addon.active)
    .map((addon) => {
      if ((addon.flatFee || 0) > 0 && (addon.nightlyFee || 0) > 0) {
        return `<li>${addon.name}: +${formatMoney(addon.flatFee)} booking fee and +${formatMoney(addon.nightlyFee)} per night</li>`;
      }
      if ((addon.flatFee || 0) > 0) {
        return `<li>${addon.name}: +${formatMoney(addon.flatFee)} booking fee</li>`;
      }
      if ((addon.nightlyFee || 0) > 0) {
        return `<li>${addon.name}: +${formatMoney(addon.nightlyFee)} per night</li>`;
      }
      return `<li>${addon.name}: no extra fee</li>`;
    });

  priceGuideEl.innerHTML = [...suiteItems, ...addonItems].join("");
}

function datesOverlap(aStart, aEnd, bStart, bEnd) {
  const startA = parseDate(aStart);
  const endA = parseDate(aEnd);
  const startB = parseDate(bStart);
  const endB = parseDate(bEnd);
  return startA < endB && endA > startB;
}

async function isDateRangeAvailable(start, end, suiteType, currentBookings = null) {
  const suiteCapacity = getSuiteCapacityMap();
  const bookings = currentBookings ?? await getBookings();
  const overlapsInSuite = bookings.filter(
    (booking) => booking.suiteType === suiteType && datesOverlap(start, end, booking.checkIn, booking.checkOut),
  ).length;
  return overlapsInSuite < (suiteCapacity[suiteType] || 1);
}

function calculateEstimate(formData) {
  const nights = Math.max(0, daysBetween(formData.checkIn, formData.checkOut));
  const suite = suiteByCode(formData.suiteType);
  const addon = addonByCode(formData.addOn);
  if (!suite) return 0;
  const suiteTotal = suite.nightlyRate * nights;
  const addonFlat = addon?.flatFee || 0;
  const addonNightly = (addon?.nightlyFee || 0) * nights;
  return suiteTotal + addonFlat + addonNightly;
}

function getMonthBounds(year, month) {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  return { start, end };
}

function isoDateFromParts(year, month, day) {
  const date = new Date(year, month, day);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mm}-${dd}`;
}

function bookingCountForDate(dateIso, suiteType, allBookings) {
  return allBookings.filter(
    (booking) => booking.suiteType === suiteType && dateIso >= booking.checkIn && dateIso < booking.checkOut,
  ).length;
}

function dayClassByCount(count, suiteType) {
  const suiteCapacity = getSuiteCapacityMap();
  const cap = suiteCapacity[suiteType] || 1;
  if (count >= cap) return "full";
  if (count > 0) return "limited";
  return "available";
}

async function renderAvailabilityCalendar() {
  const suiteType = availabilitySuite.value;
  const { year, month } = calendarState;
  const { start, end } = getMonthBounds(year, month);
  const firstWeekday = start.getDay();
  const daysInMonth = end.getDate();
  const allBookings = await getBookings();

  calendarTitleEl.textContent = new Intl.DateTimeFormat("en-MY", {
    month: "long",
    year: "numeric",
  }).format(start);

  calendarEl.innerHTML = "";
  const weekdayNames = ["S", "M", "T", "W", "T", "F", "S"];
  weekdayNames.forEach((day) => {
    const el = document.createElement("div");
    el.className = "calendar-head";
    el.textContent = day;
    calendarEl.appendChild(el);
  });

  for (let i = 0; i < firstWeekday; i += 1) {
    const pad = document.createElement("div");
    pad.className = "calendar-day empty";
    calendarEl.appendChild(pad);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const isoDate = isoDateFromParts(year, month, day);
    const count = bookingCountForDate(isoDate, suiteType, allBookings);

    const dayEl = document.createElement("div");
    dayEl.className = `calendar-day ${dayClassByCount(count, suiteType)}`;

    const dayNum = document.createElement("strong");
    dayNum.textContent = String(day);
    const countLabel = document.createElement("span");
    countLabel.className = "count";
    countLabel.textContent = count > 0 ? String(count) : "";

    dayEl.append(dayNum, countLabel);
    calendarEl.appendChild(dayEl);
  }
}

function refreshEstimate() {
  const formData = Object.fromEntries(new FormData(bookingForm).entries());
  if (!formData.checkIn || !formData.checkOut || parseDate(formData.checkOut) <= parseDate(formData.checkIn)) {
    estimatedTotalEl.textContent = formatMoney(0);
    return;
  }
  estimatedTotalEl.textContent = formatMoney(calculateEstimate(formData));
}

function showAvailabilityMessage(message, ok) {
  availabilityResult.textContent = message;
  availabilityResult.classList.remove("ok", "warn");
  availabilityResult.classList.add(ok ? "ok" : "warn");
}

async function renderBlockedRanges(suiteType) {
  const bookings = (await getBookings())
    .filter((booking) => booking.suiteType === suiteType)
    .sort((a, b) => parseDate(a.checkIn) - parseDate(b.checkIn));

  if (!bookings.length) {
    blockedRangesEl.innerHTML = "<strong>Booked date blocks:</strong> none yet for this suite.";
    return;
  }

  const items = bookings
    .slice(0, 6)
    .map((booking) => `<li>${booking.checkIn} to ${booking.checkOut}</li>`)
    .join("");

  blockedRangesEl.innerHTML = `<strong>Booked date blocks:</strong><ul>${items}</ul>`;
}

function applyBookingStatus() {
  const allowed = settings.booking.allowPublicBooking !== false;
  const formInputs = bookingForm.querySelectorAll("input, select, textarea, button");
  formInputs.forEach((el) => {
    el.disabled = !allowed;
  });
  formModeEl.textContent = allowed
    ? "Bookings are open."
    : "Bookings are temporarily closed. Please contact the administrator.";
}

function validateStepFields(index) {
  const inputs = stepEls[index].querySelectorAll("input, select, textarea");
  for (const el of inputs) {
    if (!el.reportValidity()) {
      return false;
    }
  }
  return true;
}

async function validateBookingRules() {
  const formData = Object.fromEntries(new FormData(bookingForm).entries());
  const nights = daysBetween(formData.checkIn, formData.checkOut);

  if (parseDate(formData.checkOut) <= parseDate(formData.checkIn)) {
    alert("Check-out date must be after check-in date.");
    return false;
  }

  if (nights < settings.booking.minNights) {
    alert(`Minimum stay is ${settings.booking.minNights} night(s).`);
    return false;
  }

  if (nights > settings.booking.maxNights) {
    alert(`Maximum stay is ${settings.booking.maxNights} night(s).`);
    return false;
  }

  const bookings = await getBookings();
  if (!(await isDateRangeAvailable(formData.checkIn, formData.checkOut, formData.suiteType, bookings))) {
    alert("Those dates are currently unavailable. Please choose another range.");
    return false;
  }

  return true;
}

function renderBookingSummary() {
  const formData = Object.fromEntries(new FormData(bookingForm).entries());
  const suite = suiteByCode(formData.suiteType);
  const addon = addonByCode(formData.addOn);
  const nights = Math.max(0, daysBetween(formData.checkIn, formData.checkOut));

  const rows = [
    ["Owner", `${formData.ownerName} · ${formData.ownerPhone}`],
    ["Contact email", formData.ownerEmail],
    ["Cat", `${formData.catName} (${formData.breed}, ${formData.age}y)`],
    ["Stay", `${formData.checkIn} to ${formData.checkOut} (${nights} night${nights === 1 ? "" : "s"})`],
    ["Suite", suite ? suite.name : formData.suiteType],
    ["Add-on", addon ? addon.name : "None"],
  ];
  if (formData.notes) rows.push(["Notes", formData.notes]);

  bookingSummaryEl.innerHTML = "";
  rows.forEach(([label, value]) => {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    bookingSummaryEl.append(dt, dd);
  });
}

function syncPricePanelSpacing() {
  if (!mobileLayoutQuery.matches) {
    bookingForm.style.paddingBottom = "";
    return;
  }
  const height = pricePanelEl.getBoundingClientRect().height;
  bookingForm.style.paddingBottom = `${height + 24}px`;
}

function showStep(index) {
  currentStep = index;
  const isLast = index === stepEls.length - 1;

  stepEls.forEach((el, i) => {
    el.hidden = i !== index;
  });

  stepIndicatorEl.textContent = `Step ${index + 1} of ${stepEls.length}: ${STEP_LABELS[index]}`;
  stepBackBtn.hidden = index === 0;
  stepNextBtn.hidden = isLast;
  submitBookingBtn.hidden = !isLast;

  if (isLast) renderBookingSummary();
  syncPricePanelSpacing();
}

stepNextBtn.addEventListener("click", async () => {
  if (!validateStepFields(currentStep)) return;
  if (currentStep === 0 && !(await validateBookingRules())) return;
  showStep(currentStep + 1);
});

stepBackBtn.addEventListener("click", () => {
  showStep(Math.max(0, currentStep - 1));
});

bookingForm.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.target.tagName === "TEXTAREA") return;
  if (currentStep < stepEls.length - 1) {
    event.preventDefault();
    stepNextBtn.click();
  }
});

new ResizeObserver(syncPricePanelSpacing).observe(pricePanelEl);
mobileLayoutQuery.addEventListener("change", syncPricePanelSpacing);
window.addEventListener("resize", syncPricePanelSpacing);

bookingForm.addEventListener("input", refreshEstimate);

bookingForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (settings.booking.allowPublicBooking === false) {
    alert("Bookings are currently closed.");
    return;
  }

  if (!(await validateBookingRules())) return;

  const formData = Object.fromEntries(new FormData(bookingForm).entries());
  const booking = {
    ...formData,
    id: `LB-${Date.now().toString().slice(-6)}`,
    totalPrice: calculateEstimate(formData),
  };

  await saveBooking(booking);
  availabilitySuite.value = formData.suiteType;
  bookingForm.reset();
  refreshEstimate();
  showStep(0);
  await renderBlockedRanges(availabilitySuite.value);
  await renderAvailabilityCalendar();
  showAvailabilityMessage("Reservation confirmed and dates are now blocked.", true);
});

checkAvailabilityBtn.addEventListener("click", async () => {
  const start = availabilityStart.value;
  const end = availabilityEnd.value;
  const suiteType = availabilitySuite.value;

  if (!start || !end) {
    showAvailabilityMessage("Pick both check-in and check-out dates.", false);
    return;
  }

  if (parseDate(end) <= parseDate(start)) {
    showAvailabilityMessage("Check-out must be later than check-in.", false);
    return;
  }

  const nights = daysBetween(start, end);
  if (nights < settings.booking.minNights || nights > settings.booking.maxNights) {
    showAvailabilityMessage(
      `Allowed stay is between ${settings.booking.minNights} and ${settings.booking.maxNights} nights.`,
      false,
    );
    return;
  }

  const available = await isDateRangeAvailable(start, end, suiteType);
  if (available) {
    showAvailabilityMessage("Great news. Those dates are currently available.", true);
  } else {
    showAvailabilityMessage("That period is fully booked. Try another date range.", false);
  }

  await renderBlockedRanges(suiteType);
  await renderAvailabilityCalendar();
});

availabilitySuite.addEventListener("change", async () => {
  await renderBlockedRanges(availabilitySuite.value);
  await renderAvailabilityCalendar();
});

calPrevBtn.addEventListener("click", async () => {
  calendarState.month -= 1;
  if (calendarState.month < 0) {
    calendarState.month = 11;
    calendarState.year -= 1;
  }
  await renderAvailabilityCalendar();
});

calNextBtn.addEventListener("click", async () => {
  calendarState.month += 1;
  if (calendarState.month > 11) {
    calendarState.month = 0;
    calendarState.year += 1;
  }
  await renderAvailabilityCalendar();
});

async function init() {
  settings = await getSettings();
  renderSelectOptions();
  renderPriceGuide();
  applyBookingStatus();
  refreshEstimate();
  showStep(0);
  await renderBlockedRanges(availabilitySuite.value);
  await renderAvailabilityCalendar();
}

init();
