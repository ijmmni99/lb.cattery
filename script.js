const DEFAULT_SETTINGS = {
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
  contact: {
    whatsappNumber: "",
  },
};

const bookingForm = document.getElementById("booking-form");
const estimatedTotalEl = document.getElementById("estimated-total");
const availabilityStart = document.getElementById("availability-start");
const availabilityEnd = document.getElementById("availability-end");
const availabilitySuite = document.getElementById("availability-suite");
const availabilityResult = document.getElementById("availability-result");
const checkAvailabilityBtn = document.getElementById("check-availability");
const promoBannerEl = document.getElementById("promo-banner");
const promoCarouselEl = document.getElementById("promo-carousel");
const promoTrackEl = document.getElementById("promo-track");
const promoDotsEl = document.getElementById("promo-dots");
const promoPrevBtn = document.getElementById("promo-prev");
const promoNextBtn = document.getElementById("promo-next");
const calendarTitleEl = document.getElementById("calendar-title");
const calendarEl = document.getElementById("availability-calendar");
const calPrevBtn = document.getElementById("cal-prev");
const calNextBtn = document.getElementById("cal-next");
const formModeEl = document.getElementById("form-mode");
const suiteOptionsEl = document.getElementById("suite-options");
const addonOptionsEl = document.getElementById("addon-options");
const catRowsEl = document.getElementById("cat-rows");
const addCatBtn = document.getElementById("add-cat");
const accountMenuBtn = document.getElementById("account-menu-btn");
const accountMenu = document.getElementById("account-menu");
const stepIndicatorEl = document.getElementById("step-indicator");
const stepEls = Array.from(document.querySelectorAll(".form-step"));
const stepBackBtn = document.getElementById("step-back");
const stepNextBtn = document.getElementById("step-next");
const submitBookingBtn = document.getElementById("submit-booking");
const bookingSummaryEl = document.getElementById("booking-summary");
const formErrorsEl = document.getElementById("form-errors");
const bookingCardEl = document.getElementById("booking-card");
const confirmationEl = document.getElementById("booking-confirmation");

const STEP_LABELS = ["Your stay", "Contact & confirm"];
let currentStep = 0;

const calendarState = {
  year: new Date().getFullYear(),
  month: new Date().getMonth(),
};

let calendarBookingsCache = [];
let calendarReady = false;

// Check-in / check-out picked by clicking the calendar.
const dateSelection = { start: null, end: null };

let promoSlides = [];
let promoIndex = 0;
let promoTimer = null;

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

let bookingsCache = null;

// Cached for the page's lifetime; pass force=true after a booking or an explicit refresh.
async function loadBookings(force = false) {
  if (!bookingsCache || force) bookingsCache = getBookings();
  return bookingsCache;
}

async function getBookings() {
  try {
    const res = await fetch("/api/bookings");
    if (!res.ok) {
      console.error("getBookings failed", res.status);
      return [];
    }
    const data = await res.json();
    return data.map((r) => ({
      suiteType: r.suite_type,
      checkIn: r.check_in,
      checkOut: r.check_out,
      catCount: Math.max(1, Number(r.cats) || 1),
      status: r.status,
    }));
  } catch (err) {
    console.error("getBookings failed", err);
    return [];
  }
}

// The server generates the id and price; the client only sends the stay details.
async function saveBooking(booking) {
  const res = await fetch("/api/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      owner_name: booking.ownerName,
      owner_email: booking.ownerEmail,
      owner_phone: booking.ownerPhone,
      cats: booking.cats,
      suite_type: booking.suiteType,
      check_in: booking.checkIn,
      check_out: booking.checkOut,
      add_ons: booking.addOns,
      notes: booking.notes || null,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Booking save failed");
  }
  return data;
}

async function getSettings() {
  const data = await window.lbFetchSettings();
  if (!data) return structuredClone(DEFAULT_SETTINGS);
  return normalizeSettings(data);
}

function normalizeSettings(raw) {
  const safe = raw && typeof raw === "object" ? raw : {};
  const booking = safe.booking && typeof safe.booking === "object" ? safe.booking : {};

  const suites = Array.isArray(safe.suites) ? safe.suites : DEFAULT_SETTINGS.suites;
  const addons = Array.isArray(safe.addons) ? safe.addons : DEFAULT_SETTINGS.addons;
  const promos = Array.isArray(safe.promos) ? safe.promos : DEFAULT_SETTINGS.promos;
  const contact = safe.contact && typeof safe.contact === "object" ? safe.contact : {};

  return {
    contact: {
      whatsappNumber: String(contact.whatsappNumber || "").replace(/\D/g, ""),
    },
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
        imageUrl: String(suite.imageUrl || "").trim(),
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
        imageUrl: String(promo.imageUrl || "").trim(),
        caption: String(promo.caption || "").trim(),
        linkUrl: String(promo.linkUrl || "").trim(),
        active: promo.active !== false,
      }))
      .filter((promo) => promo.imageUrl && promo.active),
  };
}

function stopPromoAutoplay() {
  if (promoTimer) {
    clearInterval(promoTimer);
    promoTimer = null;
  }
}

function startPromoAutoplay() {
  stopPromoAutoplay();
  if (promoSlides.length < 2) return;
  promoTimer = setInterval(() => goToPromo(promoIndex + 1), 5000);
}

function goToPromo(index) {
  if (!promoSlides.length) return;
  promoIndex = (index + promoSlides.length) % promoSlides.length;
  promoTrackEl.style.transform = `translateX(-${promoIndex * 100}%)`;
  Array.from(promoDotsEl.children).forEach((dot, i) => {
    dot.classList.toggle("active", i === promoIndex);
  });
}

function renderPromoBanner(promos) {
  promoSlides = promos;
  promoTrackEl.innerHTML = "";
  promoDotsEl.innerHTML = "";
  stopPromoAutoplay();

  if (!promos.length) {
    promoBannerEl.hidden = true;
    return;
  }

  promoBannerEl.hidden = false;

  promos.forEach((promo, index) => {
    const slide = document.createElement("div");
    slide.className = "promo-slide";

    const img = document.createElement("img");
    img.src = promo.imageUrl;
    img.alt = promo.caption || "Promotion";
    img.loading = "lazy";
    img.decoding = "async";

    if (promo.linkUrl) {
      const link = document.createElement("a");
      link.href = promo.linkUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.appendChild(img);
      slide.appendChild(link);
    } else {
      slide.appendChild(img);
    }

    if (promo.caption) {
      const caption = document.createElement("p");
      caption.className = "promo-caption";
      caption.textContent = promo.caption;
      slide.appendChild(caption);
    }

    promoTrackEl.appendChild(slide);

    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "promo-dot";
    dot.setAttribute("aria-label", `Go to promo ${index + 1}`);
    dot.addEventListener("click", () => {
      goToPromo(index);
      startPromoAutoplay();
    });
    promoDotsEl.appendChild(dot);
  });

  const showNav = promos.length > 1;
  promoPrevBtn.hidden = !showNav;
  promoNextBtn.hidden = !showNav;
  promoDotsEl.hidden = !showNav;

  goToPromo(0);
  startPromoAutoplay();
}

promoPrevBtn.addEventListener("click", () => {
  goToPromo(promoIndex - 1);
  startPromoAutoplay();
});

promoNextBtn.addEventListener("click", () => {
  goToPromo(promoIndex + 1);
  startPromoAutoplay();
});

promoCarouselEl.addEventListener("mouseenter", stopPromoAutoplay);
promoCarouselEl.addEventListener("mouseleave", startPromoAutoplay);
promoCarouselEl.addEventListener("touchstart", stopPromoAutoplay, { passive: true });

function renderSuiteCards(suiteOptions) {
  suiteOptionsEl.innerHTML = "";

  suiteOptions.forEach((suite, index) => {
    const card = document.createElement("label");
    card.className = "suite-card";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "suiteType";
    radio.value = suite.code;
    radio.required = true;
    if (index === 0) radio.checked = true;

    const media = document.createElement("div");
    media.className = "suite-card-media";
    if (suite.imageUrl) {
      const img = document.createElement("img");
      img.src = suite.imageUrl;
      img.alt = suite.name;
      img.loading = "lazy";
      img.decoding = "async";
      img.addEventListener("error", () => {
        media.classList.add("suite-card-media-placeholder");
        img.remove();
      });
      media.appendChild(img);
    } else {
      media.classList.add("suite-card-media-placeholder");
      media.textContent = "🐾";
    }

    const info = document.createElement("div");
    info.className = "suite-card-info";
    const nameEl = document.createElement("strong");
    nameEl.textContent = suite.name;
    const detailEl = document.createElement("span");
    detailEl.textContent = `${formatMoney(suite.nightlyRate)} / night · up to ${suite.capacity} cat${suite.capacity === 1 ? "" : "s"}`;
    info.append(nameEl, detailEl);

    card.append(radio, media, info);
    suiteOptionsEl.appendChild(card);
  });

  updateSuiteCardSelection();
}

function updateSuiteCardSelection() {
  Array.from(suiteOptionsEl.querySelectorAll(".suite-card")).forEach((card) => {
    const input = card.querySelector('input[type="radio"]');
    card.classList.toggle("selected", Boolean(input?.checked));
  });
}

bookingForm.addEventListener("change", (event) => {
  if (event.target.name !== "suiteType") return;
  updateSuiteCardSelection();
  availabilitySuite.value = event.target.value;
  if (calendarReady) paintCalendar();
});

function renderSelectOptions() {
  const suiteOptions = settings.suites.filter((suite) => suite.active);
  availabilitySuite.innerHTML = "";

  suiteOptions.forEach((suite) => {
    const optionB = document.createElement("option");
    optionB.value = suite.code;
    optionB.textContent = suite.name;
    availabilitySuite.appendChild(optionB);
  });

  renderSuiteCards(suiteOptions);

  const addonOptions = settings.addons.filter((addon) => addon.active && addon.code !== "none");
  addonOptionsEl.innerHTML = "";
  addonOptions.forEach((addon) => {
    const label = document.createElement("label");
    label.className = "addon-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "addOn";
    checkbox.value = addon.code;
    const textEl = document.createElement("span");
    textEl.textContent = `${addon.name} (${formatAddonFee(addon)})`;
    label.append(checkbox, textEl);
    addonOptionsEl.appendChild(label);
  });
}

function createCatRow() {
  const row = document.createElement("div");
  row.className = "cat-card";

  const header = document.createElement("div");
  header.className = "cat-card-header";
  const title = document.createElement("strong");
  title.textContent = "Cat";
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "secondary remove-cat-btn";
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", () => {
    row.remove();
    updateCatRowChrome();
  });
  header.append(title, removeBtn);

  const fields = document.createElement("div");
  fields.className = "grid two";
  fields.innerHTML = `
    <label>
      Cat name
      <input type="text" name="catName[]" required />
    </label>
    <label>
      Breed
      <input type="text" name="breed[]" required />
    </label>
    <label>
      Age (years)
      <input type="number" name="age[]" min="0" max="30" step="0.5" required />
    </label>
    <div class="vaccination-fields">
      <label class="check-inline">
        <input type="checkbox" name="vaccinated[]" />
        Vaccination up to date
      </label>
      <label>
        Vaccination date (optional)
        <input type="date" name="vaccinationDate[]" max="${todayIso()}" />
      </label>
    </div>
  `;

  row.append(header, fields);
  return row;
}

function updateCatRowChrome() {
  const rows = Array.from(catRowsEl.querySelectorAll(".cat-card"));
  rows.forEach((row, index) => {
    row.querySelector(".cat-card-header strong").textContent = `Cat ${index + 1}`;
    const removeBtn = row.querySelector(".remove-cat-btn");
    removeBtn.hidden = rows.length <= 1;
  });
  // Cat count changes which days still have room.
  if (calendarReady) paintCalendar();
}

function addCatRow() {
  catRowsEl.appendChild(createCatRow());
  updateCatRowChrome();
}

function resetCatRows() {
  catRowsEl.innerHTML = "";
  addCatRow();
}

function collectCats() {
  return Array.from(catRowsEl.querySelectorAll(".cat-card")).map((row) => ({
    name: row.querySelector('input[name="catName[]"]').value.trim(),
    breed: row.querySelector('input[name="breed[]"]').value.trim(),
    age: row.querySelector('input[name="age[]"]').value,
    vaccinated: row.querySelector('input[name="vaccinated[]"]').checked,
    vaccinationDate: row.querySelector('input[name="vaccinationDate[]"]').value,
  }));
}

function collectAddOns() {
  return Array.from(addonOptionsEl.querySelectorAll('input[name="addOn"]:checked')).map((el) => el.value);
}

addCatBtn.addEventListener("click", addCatRow);

function formatAddonFee(addon) {
  const flatFee = addon.flatFee || 0;
  const nightlyFee = addon.nightlyFee || 0;
  if (flatFee > 0 && nightlyFee > 0) {
    return `+${formatMoney(flatFee)} booking fee + ${formatMoney(nightlyFee)}/night`;
  }
  if (flatFee > 0) {
    return `+${formatMoney(flatFee)} booking fee`;
  }
  if (nightlyFee > 0) {
    return `+${formatMoney(nightlyFee)}/night`;
  }
  return "no extra fee";
}

function catsOnNight(dateIso, suiteType, allBookings) {
  return allBookings
    .filter((booking) => booking.suiteType === suiteType && dateIso >= booking.checkIn && dateIso < booking.checkOut)
    .reduce((sum, booking) => sum + booking.catCount, 0);
}

function eachNightIso(start, end) {
  const nights = [];
  const cursor = parseDate(start);
  const stop = parseDate(end);
  while (cursor < stop) {
    nights.push(isoDateFromParts(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()));
    cursor.setDate(cursor.getDate() + 1);
  }
  return nights;
}

async function isDateRangeAvailable(start, end, suiteType, currentBookings = null, newCats = 1) {
  const capacity = getSuiteCapacityMap()[suiteType] || 1;
  const bookings = currentBookings ?? await loadBookings();
  return eachNightIso(start, end).every((night) => catsOnNight(night, suiteType, bookings) + newCats <= capacity);
}

function calculateEstimate(formData, addOnCodes = [], catCount = 1) {
  const nights = Math.max(0, daysBetween(formData.checkIn, formData.checkOut));
  const suite = suiteByCode(formData.suiteType);
  if (!suite) return 0;
  const suiteTotal = suite.nightlyRate * nights * Math.max(1, catCount);
  const addonsTotal = addOnCodes.reduce((sum, code) => {
    const addon = addonByCode(code);
    if (!addon) return sum;
    return sum + (addon.flatFee || 0) + (addon.nightlyFee || 0) * nights;
  }, 0);
  return suiteTotal + addonsTotal;
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

function todayIso() {
  const now = new Date();
  return isoDateFromParts(now.getFullYear(), now.getMonth(), now.getDate());
}

function formCatCount() {
  return Math.max(1, collectCats().length);
}

function isNightFree(dateIso, suiteType, bookings, newCats) {
  const capacity = getSuiteCapacityMap()[suiteType] || 1;
  return catsOnNight(dateIso, suiteType, bookings) + newCats <= capacity;
}

// A day is disabled when it is in the past or full. While waiting for a check-out, days after the check-in
// stay enabled only if every night in between is free (so a full day can still be a check-out day).
function isCalendarDayDisabled(dateIso, suiteType, bookings) {
  if (dateIso < todayIso()) return true;
  const newCats = formCatCount();
  const awaitingEnd = dateSelection.start && !dateSelection.end;
  if (awaitingEnd && dateIso > dateSelection.start) {
    const nights = eachNightIso(dateSelection.start, dateIso);
    if (nights.length > settings.booking.maxNights) return true;
    return !nights.every((night) => isNightFree(night, suiteType, bookings, newCats));
  }
  return !isNightFree(dateIso, suiteType, bookings, newCats);
}

function showCalendarSkeleton() {
  calendarEl.classList.add("is-loading");
  calendarEl.setAttribute("aria-busy", "true");
  calendarEl.innerHTML = "";
  for (let i = 0; i < 35; i += 1) {
    const cell = document.createElement("div");
    cell.className = "calendar-day skeleton";
    calendarEl.appendChild(cell);
  }
}

function paintCalendar() {
  const suiteType = availabilitySuite.value;
  const { year, month } = calendarState;
  const { start, end } = getMonthBounds(year, month);
  const firstWeekday = start.getDay();
  const daysInMonth = end.getDate();
  const allBookings = calendarBookingsCache;

  calendarTitleEl.textContent = new Intl.DateTimeFormat("en-MY", {
    month: "long",
    year: "numeric",
  }).format(start);

  calendarEl.classList.remove("is-loading");
  calendarEl.setAttribute("aria-busy", "false");
  calendarEl.innerHTML = "";
  ["S", "M", "T", "W", "T", "F", "S"].forEach((day) => {
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
    const disabled = isCalendarDayDisabled(isoDate, suiteType, allBookings);
    const isStart = isoDate === dateSelection.start;
    const isEnd = isoDate === dateSelection.end;
    const inRange = dateSelection.start && dateSelection.end && isoDate > dateSelection.start && isoDate < dateSelection.end;

    const dayEl = document.createElement("button");
    dayEl.type = "button";
    dayEl.className = `calendar-day ${dayClassByCount(count, suiteType)}`;
    if (isStart) dayEl.classList.add("sel-start");
    if (isEnd) dayEl.classList.add("sel-end");
    if (inRange) dayEl.classList.add("sel-range");
    dayEl.dataset.date = isoDate;
    dayEl.disabled = disabled;
    dayEl.setAttribute("aria-pressed", isStart || isEnd ? "true" : "false");

    const parts = [formatDateLong(isoDate), count > 0 ? `${count} cat${count > 1 ? "s" : ""} booked` : "no bookings"];
    if (isStart) parts.push("check-in");
    if (isEnd) parts.push("check-out");
    if (disabled) parts.push("not available");
    dayEl.setAttribute("aria-label", parts.join(", "));

    const dayNum = document.createElement("strong");
    dayNum.textContent = String(day);
    const countLabel = document.createElement("span");
    countLabel.className = "count";
    countLabel.textContent = count > 0 ? String(count) : "";

    dayEl.append(dayNum, countLabel);
    calendarEl.appendChild(dayEl);
  }
}

async function renderAvailabilityCalendar() {
  calendarBookingsCache = await loadBookings();
  calendarReady = true;
  paintCalendar();
}

function setBookingFormDates(start, end) {
  bookingForm.elements.checkIn.value = start || "";
  bookingForm.elements.checkOut.value = end || "";
  availabilityStart.value = start || "";
  availabilityEnd.value = end || "";
  refreshEstimate();
}

function scrollToBookingForm() {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  bookingCardEl.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  bookingCardEl.focus({ preventScroll: true });
}

function handleCalendarDayClick(dateIso) {
  const { start, end } = dateSelection;

  if (!start || end || dateIso <= start) {
    dateSelection.start = dateIso;
    dateSelection.end = null;
    setBookingFormDates(dateIso, "");
    showAvailabilityMessage(`Check-in set to ${formatDateLong(dateIso)}. Now pick your check-out day.`, true);
    paintCalendar();
    return;
  }

  const nights = daysBetween(start, dateIso);
  if (nights < settings.booking.minNights) {
    showAvailabilityMessage(`Minimum stay is ${settings.booking.minNights} night(s). Pick a later check-out day.`, false);
    return;
  }

  dateSelection.end = dateIso;
  setBookingFormDates(start, dateIso);
  showAvailabilityMessage(`${formatDateLong(start)} to ${formatDateLong(dateIso)} (${nights} night${nights === 1 ? "" : "s"}). Fill in the booking form below.`, true);
  paintCalendar();
  scrollToBookingForm();
}

calendarEl.addEventListener("click", (event) => {
  const dayEl = event.target.closest(".calendar-day:not(.empty):not(:disabled)");
  if (!dayEl?.dataset.date) return;
  handleCalendarDayClick(dayEl.dataset.date);
});

// Keep the calendar selection in step with dates typed into either date form.
function syncSelectionFromInputs(start, end) {
  dateSelection.start = start || null;
  dateSelection.end = start && end && end > start ? end : null;
  if (calendarReady) paintCalendar();
}

bookingForm.elements.checkIn.addEventListener("change", () => {
  availabilityStart.value = bookingForm.elements.checkIn.value;
  syncSelectionFromInputs(bookingForm.elements.checkIn.value, bookingForm.elements.checkOut.value);
});
bookingForm.elements.checkOut.addEventListener("change", () => {
  availabilityEnd.value = bookingForm.elements.checkOut.value;
  syncSelectionFromInputs(bookingForm.elements.checkIn.value, bookingForm.elements.checkOut.value);
});
availabilityStart.addEventListener("change", () => {
  bookingForm.elements.checkIn.value = availabilityStart.value;
  syncSelectionFromInputs(availabilityStart.value, availabilityEnd.value);
});
availabilityEnd.addEventListener("change", () => {
  bookingForm.elements.checkOut.value = availabilityEnd.value;
  syncSelectionFromInputs(availabilityStart.value, availabilityEnd.value);
});

function formatDateLong(dateIso) {
  return new Intl.DateTimeFormat("en-MY", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(parseDate(dateIso));
}

function refreshEstimate() {
  const formData = Object.fromEntries(new FormData(bookingForm).entries());
  if (!formData.checkIn || !formData.checkOut || parseDate(formData.checkOut) <= parseDate(formData.checkIn)) {
    estimatedTotalEl.textContent = formatMoney(0);
    return;
  }
  estimatedTotalEl.textContent = formatMoney(calculateEstimate(formData, collectAddOns(), collectCats().length));
}

function showAvailabilityMessage(message, ok) {
  availabilityResult.textContent = message;
  availabilityResult.classList.remove("ok", "warn");
  availabilityResult.classList.add(ok ? "ok" : "warn");
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

function fieldLabel(el) {
  const catTitle = el.closest(".cat-card")?.querySelector(".cat-card-header strong")?.textContent;
  let label = "";
  if (el.type === "radio") {
    label = el.closest(".suite-field")?.querySelector(".suite-field-label")?.textContent || "Suite type";
  } else {
    const wrapper = el.closest("label");
    label = wrapper ? Array.from(wrapper.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join(" ") : "";
  }
  label = label.replace(/\s+/g, " ").trim() || el.name || "Field";
  return catTitle ? `${catTitle} – ${label}` : label;
}

function clearFormErrors() {
  formErrorsEl.textContent = "";
  bookingForm.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
}

// Lists messages in the aria-live region and moves focus to the offending field (or the region itself).
function showFormErrors(messages, focusEl = null) {
  formErrorsEl.textContent = "";
  const list = document.createElement("ul");
  messages.forEach((message) => {
    const li = document.createElement("li");
    li.textContent = message;
    list.appendChild(li);
  });
  formErrorsEl.appendChild(list);
  (focusEl || formErrorsEl).focus();
}

function validateStepFields(index) {
  clearFormErrors();
  const invalid = [];
  const seenGroups = new Set();
  stepEls[index].querySelectorAll("input, select, textarea").forEach((el) => {
    if (el.disabled || el.checkValidity()) return;
    if (el.type === "radio") {
      if (seenGroups.has(el.name)) return;
      seenGroups.add(el.name);
    }
    invalid.push(el);
  });
  if (!invalid.length) return true;

  invalid.forEach((el) => el.setAttribute("aria-invalid", "true"));
  showFormErrors(invalid.map((el) => `${fieldLabel(el)}: ${el.validationMessage}`), invalid[0]);
  return false;
}

async function validateBookingRules() {
  const formData = Object.fromEntries(new FormData(bookingForm).entries());
  const checkOutInput = bookingForm.elements.checkOut;
  const nights = daysBetween(formData.checkIn, formData.checkOut);

  const fail = (message, field) => {
    if (field) field.setAttribute("aria-invalid", "true");
    showFormErrors([message], field);
    return false;
  };

  if (parseDate(formData.checkOut) <= parseDate(formData.checkIn)) {
    return fail("Check-out date must be after check-in date.", checkOutInput);
  }
  if (nights < settings.booking.minNights) {
    return fail(`Minimum stay is ${settings.booking.minNights} night(s).`, checkOutInput);
  }
  if (nights > settings.booking.maxNights) {
    return fail(`Maximum stay is ${settings.booking.maxNights} night(s).`, checkOutInput);
  }

  const bookings = await loadBookings(true);
  calendarBookingsCache = bookings;
  const available = await isDateRangeAvailable(formData.checkIn, formData.checkOut, formData.suiteType, bookings, formCatCount());
  if (!available) {
    paintCalendar();
    return fail("Those dates are currently unavailable for this suite. Please choose another range.", bookingForm.elements.checkIn);
  }

  return true;
}

function renderBookingSummary() {
  const formData = Object.fromEntries(new FormData(bookingForm).entries());
  const suite = suiteByCode(formData.suiteType);
  const cats = collectCats();
  const addOnCodes = collectAddOns();
  const addonNames = addOnCodes.map((code) => addonByCode(code)?.name).filter(Boolean);
  const nights = Math.max(0, daysBetween(formData.checkIn, formData.checkOut));

  const rows = [
    ["Stay", `${formData.checkIn} to ${formData.checkOut} (${nights} night${nights === 1 ? "" : "s"})`],
    ["Suite", suite ? suite.name : formData.suiteType],
    ["Cats", cats.map((cat) => cat.name).join(", ") || "-"],
    ["Add-ons", addonNames.length ? addonNames.join(", ") : "None"],
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
}

stepNextBtn.addEventListener("click", async () => {
  if (!validateStepFields(currentStep)) return;
  if (currentStep === 0 && !(await validateBookingRules())) return;
  clearFormErrors();
  showStep(currentStep + 1);
  stepEls[currentStep].querySelector("input, select, textarea")?.focus();
});

stepBackBtn.addEventListener("click", () => {
  clearFormErrors();
  showStep(Math.max(0, currentStep - 1));
});

bookingForm.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.target.tagName === "TEXTAREA") return;
  if (currentStep < stepEls.length - 1) {
    event.preventDefault();
    stepNextBtn.click();
  }
});

bookingForm.addEventListener("input", refreshEstimate);

// ---- Owner pre-fill from a logged-in customer session ------------------------

let sessionProfile = null;

function applyOwnerPrefill() {
  if (!sessionProfile) return;
  const fields = { ownerName: sessionProfile.name, ownerEmail: sessionProfile.email, ownerPhone: sessionProfile.phone };
  Object.entries(fields).forEach(([name, value]) => {
    const input = bookingForm.elements[name];
    if (input && value && !input.value) input.value = value;
  });
}

async function loadSessionProfile() {
  const token = safeStorage((store) => store.getItem("lb_user_token"));
  if (!token) return;
  try {
    const res = await fetch("/api/user-auth", { headers: { "x-user-token": token } });
    if (!res.ok) return;
    const data = await res.json();
    sessionProfile = { name: data.name || "", email: data.email || "", phone: data.phone || "" };
    applyOwnerPrefill();
  } catch (err) {
    console.error("session prefill failed", err);
  }
}

// ---- Confirmation panel ------------------------------------------------------

function showConfirmation(saved, booking) {
  const suite = suiteByCode(booking.suiteType);
  const catNames = booking.cats.map((cat) => cat.name).join(", ");

  document.getElementById("confirm-id").textContent = saved.id;
  document.getElementById("copy-status").textContent = "";
  document.getElementById("confirm-message").textContent =
    `We'll review your booking and email ${booking.ownerEmail} once it's confirmed. Keep this ID to look it up later.`;
  document.getElementById("confirm-lookup-link").href = `booking-lookup.html?id=${encodeURIComponent(saved.id)}`;

  const whatsappLink = document.getElementById("confirm-whatsapp");
  const number = window.lbWhatsappNumber(settings);
  if (number) {
    const text = `Hi L&B Cattery, I just made booking ${saved.id} for ${catNames} (${suite ? suite.name : booking.suiteType}), ${booking.checkIn} to ${booking.checkOut}.`;
    whatsappLink.href = window.lbWhatsappUrl(number, text);
    whatsappLink.hidden = false;
  } else {
    whatsappLink.hidden = true;
  }

  bookingForm.hidden = true;
  stepIndicatorEl.hidden = true;
  confirmationEl.hidden = false;
  confirmationEl.focus();
}

document.getElementById("copy-booking-id").addEventListener("click", async () => {
  const idEl = document.getElementById("confirm-id");
  const statusEl = document.getElementById("copy-status");
  try {
    await navigator.clipboard.writeText(idEl.textContent);
    statusEl.textContent = "Booking ID copied.";
  } catch {
    const range = document.createRange();
    range.selectNodeContents(idEl);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    statusEl.textContent = "Press Ctrl/Cmd+C to copy the selected booking ID.";
  }
});

document.getElementById("new-booking").addEventListener("click", () => {
  confirmationEl.hidden = true;
  bookingForm.hidden = false;
  stepIndicatorEl.hidden = false;
  showStep(0);
  applyOwnerPrefill();
  bookingForm.elements.checkIn.focus();
});

bookingForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (settings.booking.allowPublicBooking === false) {
    showFormErrors(["Bookings are currently closed."]);
    return;
  }

  if (!validateStepFields(currentStep)) return;
  if (!(await validateBookingRules())) return;

  const formData = Object.fromEntries(new FormData(bookingForm).entries());
  const booking = { ...formData, cats: collectCats(), addOns: collectAddOns() };

  submitBookingBtn.disabled = true;
  let saved;
  try {
    saved = await saveBooking(booking);
  } catch (err) {
    submitBookingBtn.disabled = false;
    showFormErrors([err.message || "Could not save your booking. Please try again."]);
    await loadBookings(true).then((rows) => {
      calendarBookingsCache = rows;
      paintCalendar();
    });
    return;
  }
  submitBookingBtn.disabled = false;

  availabilitySuite.value = formData.suiteType;
  bookingForm.reset();
  resetCatRows();
  dateSelection.start = null;
  dateSelection.end = null;
  refreshEstimate();
  showStep(0);
  showConfirmation(saved, booking);
  calendarBookingsCache = await loadBookings(true);
  paintCalendar();
  showAvailabilityMessage(`Booking ${saved.id} submitted.`, true);
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

  const bookings = await loadBookings(true);
  const available = await isDateRangeAvailable(start, end, suiteType, bookings, formCatCount());
  if (available) {
    dateSelection.start = start;
    dateSelection.end = end;
    setBookingFormDates(start, end);
    showAvailabilityMessage("Great news. Those dates are currently available. Fill in the booking form below.", true);
  } else {
    showAvailabilityMessage("That period is fully booked. Try another date range.", false);
  }

  calendarBookingsCache = bookings;
  paintCalendar();
  if (available) scrollToBookingForm();
});

// The availability checker and the booking form share one suite choice.
availabilitySuite.addEventListener("change", () => {
  const radio = Array.from(bookingForm.querySelectorAll('input[name="suiteType"]')).find((el) => el.value === availabilitySuite.value);
  if (radio) {
    radio.checked = true;
    updateSuiteCardSelection();
  }
  paintCalendar();
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

// Re-render options after settings arrive without losing what the visitor already picked.
function refreshFormFromSettings() {
  const selectedSuite = bookingForm.querySelector('input[name="suiteType"]:checked')?.value;
  const checkedAddOns = new Set(collectAddOns());
  const availabilitySuiteValue = availabilitySuite.value;

  renderSelectOptions();

  const suiteRadio = Array.from(bookingForm.querySelectorAll('input[name="suiteType"]')).find((el) => el.value === selectedSuite);
  if (suiteRadio) {
    suiteRadio.checked = true;
    updateSuiteCardSelection();
  }
  Array.from(addonOptionsEl.querySelectorAll('input[name="addOn"]')).forEach((el) => {
    el.checked = checkedAddOns.has(el.value);
  });
  if (Array.from(availabilitySuite.options).some((o) => o.value === availabilitySuiteValue)) {
    availabilitySuite.value = availabilitySuiteValue;
  }
}

// ---- PWA: service worker + install prompts ----------------------------------

function safeStorage(action) {
  try {
    return action(window.localStorage);
  } catch {
    return null;
  }
}

function setupPwa() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => console.error("service worker registration failed", err));
    });
  }

  const banner = document.getElementById("install-banner");
  const installBtn = document.getElementById("install-btn");
  const dismissBtn = document.getElementById("install-dismiss");
  const iosHint = document.getElementById("ios-install-hint");
  const iosDismiss = document.getElementById("ios-hint-dismiss");
  let deferredPrompt = null;

  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (isStandalone) return;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    if (safeStorage((s) => s.getItem("lb_install_dismissed"))) return;
    deferredPrompt = event;
    banner.hidden = false;
  });

  installBtn?.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    banner.hidden = true;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => null);
    deferredPrompt = null;
  });

  dismissBtn?.addEventListener("click", () => {
    banner.hidden = true;
    safeStorage((s) => s.setItem("lb_install_dismissed", "1"));
  });

  window.addEventListener("appinstalled", () => {
    banner.hidden = true;
  });

  const ua = window.navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
  if (isIos && isSafari && !safeStorage((s) => s.getItem("lb_ios_hint_seen"))) {
    iosHint.hidden = false;
    safeStorage((s) => s.setItem("lb_ios_hint_seen", "1"));
    iosDismiss?.addEventListener("click", () => {
      iosHint.hidden = true;
    });
  }
}

async function init() {
  setupPwa();

  const today = todayIso();
  [bookingForm.elements.checkIn, bookingForm.elements.checkOut, availabilityStart, availabilityEnd].forEach((input) => {
    input.min = today;
  });

  // Render immediately from defaults; no blocking overlay.
  renderSelectOptions();
  resetCatRows();
  applyBookingStatus();
  refreshEstimate();
  showStep(0);
  showCalendarSkeleton();
  loadSessionProfile();

  // Fire both requests in parallel.
  const bookingsPromise = loadBookings();
  const loadedSettings = await getSettings().catch(() => null);

  if (loadedSettings) {
    settings = loadedSettings;
    refreshFormFromSettings();
    renderPromoBanner(settings.promos);
    applyBookingStatus();
    refreshEstimate();
  }

  await bookingsPromise;
  await renderAvailabilityCalendar();
}

init();
