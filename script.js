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
const calendarPopover = document.getElementById("calendar-popover");
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
const bookingStatusEl = document.getElementById("booking-status");

const STEP_LABELS = ["Suite & Dates", "Cat Details", "Contact Info", "Review & Confirm"];
let currentStep = 0;

const calendarState = {
  year: new Date().getFullYear(),
  month: new Date().getMonth(),
};

let calendarBookingsCache = [];
let activeCalendarDay = null;
let calendarRequestToken = 0;

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

/** Cat slots a suite holds. Capacity is measured in cats, matching per-cat pricing. */
function suiteCapacity(suiteType) {
  const suite = suiteByCode(suiteType);
  return suite ? Math.max(1, Number(suite.capacity) || 1) : 1;
}

/**
 * Public occupancy feed. Returns only which suite is busy, for which nights, for
 * how many cats -- no owner names, emails or notes.
 */
async function getOccupancy() {
  const res = await fetch("/api/availability");
  if (!res.ok) {
    console.error("getOccupancy failed", res.status);
    throw new Error("Could not load availability. Please try again.");
  }
  const data = await res.json();
  return Array.isArray(data.occupancy) ? data.occupancy : [];
}

/**
 * The server recomputes the id, price and availability; this payload is a request,
 * not a record. The booking id comes back in the response.
 */
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
    console.error("saveBooking failed", res.status, data);
    throw new Error(data.error || "We could not save your booking. Please try again.");
  }
  return data;
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
  const promos = Array.isArray(safe.promos) ? safe.promos : DEFAULT_SETTINGS.promos;

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
    if (index === 0) radio.defaultChecked = true;

    const media = document.createElement("div");
    media.className = "suite-card-media";
    if (suite.imageUrl) {
      const img = document.createElement("img");
      img.src = suite.imageUrl;
      img.alt = suite.name;
      img.loading = "lazy";
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
  if (event.target.name === "suiteType") updateSuiteCardSelection();
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
    refreshEstimate();
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
}

function addCatRow() {
  catRowsEl.appendChild(createCatRow());
  updateCatRowChrome();
  refreshEstimate();
}

function resetCatRows() {
  catRowsEl.innerHTML = "";
  addCatRow();
}

function collectCats() {
  const names = Array.from(catRowsEl.querySelectorAll('input[name="catName[]"]')).map((el) => el.value.trim());
  const breeds = Array.from(catRowsEl.querySelectorAll('input[name="breed[]"]')).map((el) => el.value.trim());
  const ages = Array.from(catRowsEl.querySelectorAll('input[name="age[]"]')).map((el) => el.value);
  return names.map((name, index) => ({ name, breed: breeds[index] || "", age: ages[index] || "" }));
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

function datesOverlap(aStart, aEnd, bStart, bEnd) {
  const startA = parseDate(aStart);
  const endA = parseDate(aEnd);
  const startB = parseDate(bStart);
  const endB = parseDate(bEnd);
  return startA < endB && endA > startB;
}

/** Cat slots already taken in a suite across a date range. */
function catsBookedInRange(occupancy, suiteType, start, end) {
  return occupancy
    .filter((entry) => entry.suiteType === suiteType && datesOverlap(start, end, entry.checkIn, entry.checkOut))
    .reduce((sum, entry) => sum + (Number(entry.cats) || 1), 0);
}

/** Free cat slots in a suite across a date range. Negative is clamped to zero. */
async function spacesLeftInRange(start, end, suiteType, currentOccupancy = null) {
  const occupancy = currentOccupancy ?? (await getOccupancy());
  return Math.max(0, suiteCapacity(suiteType) - catsBookedInRange(occupancy, suiteType, start, end));
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

function catsBookedOnDate(dateIso, suiteType, occupancy) {
  return occupancy
    .filter((entry) => entry.suiteType === suiteType && dateIso >= entry.checkIn && dateIso < entry.checkOut)
    .reduce((sum, entry) => sum + (Number(entry.cats) || 1), 0);
}

function dayClassByCount(count, suiteType) {
  if (count >= suiteCapacity(suiteType)) return "full";
  if (count > 0) return "limited";
  return "available";
}

async function renderAvailabilityCalendar() {
  // Prev/Next can be clicked faster than the fetch resolves; only the newest
  // request is allowed to paint.
  const token = ++calendarRequestToken;
  const suiteType = availabilitySuite.value;
  const { year, month } = calendarState;
  const { start, end } = getMonthBounds(year, month);
  const firstWeekday = start.getDay();
  const daysInMonth = end.getDate();

  let occupancy;
  try {
    occupancy = await getOccupancy();
  } catch (err) {
    if (token !== calendarRequestToken) return;
    calendarEl.innerHTML = "";
    const errorEl = document.createElement("p");
    errorEl.className = "calendar-error";
    errorEl.textContent = "Could not load availability right now. Please refresh the page.";
    calendarEl.appendChild(errorEl);
    return;
  }

  if (token !== calendarRequestToken) return;

  calendarBookingsCache = occupancy;
  closeCalendarPopover();

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

  const capacity = suiteCapacity(suiteType);

  for (let day = 1; day <= daysInMonth; day += 1) {
    const isoDate = isoDateFromParts(year, month, day);
    const count = catsBookedOnDate(isoDate, suiteType, occupancy);

    const dayEl = document.createElement("button");
    dayEl.type = "button";
    dayEl.className = `calendar-day ${dayClassByCount(count, suiteType)}`;
    dayEl.dataset.date = isoDate;
    dayEl.setAttribute("aria-haspopup", "dialog");
    dayEl.setAttribute(
      "aria-label",
      `${formatDateLong(isoDate)}: ${count} of ${capacity} cat space${capacity === 1 ? "" : "s"} booked. Tap for summary.`,
    );

    const dayNum = document.createElement("strong");
    dayNum.textContent = String(day);
    const countLabel = document.createElement("span");
    countLabel.className = "count";
    countLabel.textContent = count > 0 ? String(count) : "";

    dayEl.append(dayNum, countLabel);
    calendarEl.appendChild(dayEl);
  }
}

function formatDateLong(dateIso) {
  return new Intl.DateTimeFormat("en-MY", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(parseDate(dateIso));
}

function bookingsSummaryForDate(dateIso, occupancy) {
  const matches = occupancy.filter((entry) => dateIso >= entry.checkIn && dateIso < entry.checkOut);
  const bySuite = new Map();
  let total = 0;
  matches.forEach((entry) => {
    const suite = suiteByCode(entry.suiteType);
    const label = suite ? suite.name : entry.suiteType;
    const cats = Number(entry.cats) || 1;
    total += cats;
    bySuite.set(label, (bySuite.get(label) || 0) + cats);
  });
  return { total, bySuite };
}

function closeCalendarPopover() {
  if (!calendarPopover) return;
  calendarPopover.hidden = true;
  calendarPopover.innerHTML = "";
  if (activeCalendarDay) {
    activeCalendarDay.classList.remove("day-active");
    activeCalendarDay = null;
  }
}

function positionCalendarPopover(anchorEl) {
  const rect = anchorEl.getBoundingClientRect();
  const popRect = calendarPopover.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - popRect.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - popRect.width - 8));
  let top = rect.bottom + 8;
  if (top + popRect.height > window.innerHeight - 8) {
    top = rect.top - popRect.height - 8;
  }
  calendarPopover.style.left = `${left}px`;
  calendarPopover.style.top = `${top}px`;
}

function renderCalendarPopover(dateIso, anchorEl) {
  const { total, bySuite } = bookingsSummaryForDate(dateIso, calendarBookingsCache);
  calendarPopover.innerHTML = "";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "popover-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", closeCalendarPopover);

  const heading = document.createElement("h4");
  heading.textContent = formatDateLong(dateIso);

  calendarPopover.append(closeBtn, heading);

  if (total === 0) {
    const empty = document.createElement("p");
    empty.className = "popover-empty";
    empty.textContent = "No cats booked in on this date.";
    calendarPopover.appendChild(empty);
  } else {
    const summaryLine = document.createElement("p");
    summaryLine.className = "popover-total";
    summaryLine.textContent = `${total} cat${total > 1 ? "s" : ""} booked in across all suites`;

    const list = document.createElement("ul");
    bySuite.forEach((count, label) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = label;
      const num = document.createElement("span");
      num.textContent = `${count} cat${count > 1 ? "s" : ""}`;
      li.append(name, num);
      list.appendChild(li);
    });

    calendarPopover.append(summaryLine, list);
  }

  calendarPopover.hidden = false;
  positionCalendarPopover(anchorEl);
}

function toggleCalendarPopover(dayEl) {
  const dateIso = dayEl.dataset.date;
  if (!dateIso) return;
  if (activeCalendarDay === dayEl && !calendarPopover.hidden) {
    closeCalendarPopover();
    return;
  }
  if (activeCalendarDay) activeCalendarDay.classList.remove("day-active");
  activeCalendarDay = dayEl;
  dayEl.classList.add("day-active");
  renderCalendarPopover(dateIso, dayEl);
}

if (calendarEl && calendarPopover) {
  calendarEl.addEventListener("click", (event) => {
    const dayEl = event.target.closest(".calendar-day:not(.empty)");
    if (!dayEl) return;
    toggleCalendarPopover(dayEl);
  });

  document.addEventListener("click", (event) => {
    if (calendarPopover.hidden) return;
    const target = event.target;
    if (calendarPopover.contains(target) || (activeCalendarDay && activeCalendarDay.contains(target))) return;
    closeCalendarPopover();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !calendarPopover.hidden) closeCalendarPopover();
  });

  window.addEventListener("resize", () => {
    if (!calendarPopover.hidden && activeCalendarDay) positionCalendarPopover(activeCalendarDay);
  });

  window.addEventListener(
    "scroll",
    () => {
      if (!calendarPopover.hidden) closeCalendarPopover();
    },
    { capture: true, passive: true },
  );
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

function showBookingMessage(message, ok) {
  if (!bookingStatusEl) return;
  bookingStatusEl.textContent = message;
  bookingStatusEl.classList.remove("ok", "warn");
  if (message) bookingStatusEl.classList.add(ok ? "ok" : "warn");
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

/**
 * Client-side mirror of the server rules -- fast feedback only. The server
 * revalidates everything, so a bypass here cannot create an invalid booking.
 */
async function validateBookingRules() {
  const formData = Object.fromEntries(new FormData(bookingForm).entries());
  const nights = daysBetween(formData.checkIn, formData.checkOut);
  const catCount = Math.max(1, collectCats().length);

  if (parseDate(formData.checkOut) <= parseDate(formData.checkIn)) {
    showBookingMessage("Check-out date must be after check-in date.", false);
    return false;
  }

  if (nights < settings.booking.minNights) {
    showBookingMessage(`Minimum stay is ${settings.booking.minNights} night(s).`, false);
    return false;
  }

  if (nights > settings.booking.maxNights) {
    showBookingMessage(`Maximum stay is ${settings.booking.maxNights} night(s).`, false);
    return false;
  }

  let spaces;
  try {
    spaces = await spacesLeftInRange(formData.checkIn, formData.checkOut, formData.suiteType);
  } catch (err) {
    showBookingMessage(err.message || "Could not check availability. Please try again.", false);
    return false;
  }

  if (spaces < catCount) {
    showBookingMessage(
      spaces === 0
        ? "That suite is fully booked for those dates. Please choose another range."
        : `Only ${spaces} cat space(s) left in that suite for those dates; you selected ${catCount}.`,
      false,
    );
    return false;
  }

  showBookingMessage("", true);
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
    ["Owner", `${formData.ownerName} · ${formData.ownerPhone}`],
    ["Contact email", formData.ownerEmail],
    ["Cats", cats.map((cat) => `${cat.name} (${cat.breed}, ${cat.age}y)`).join("; ") || "-"],
    ["Stay", `${formData.checkIn} to ${formData.checkOut} (${nights} night${nights === 1 ? "" : "s"})`],
    ["Suite", suite ? suite.name : formData.suiteType],
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
  if (stepNextBtn.disabled) return;
  if (!validateStepFields(currentStep)) return;

  // Step 0 checks live availability, so show progress rather than a dead button.
  if (currentStep === 0) {
    stepNextBtn.disabled = true;
    stepNextBtn.textContent = "Checking...";
    try {
      if (!(await validateBookingRules())) return;
    } finally {
      stepNextBtn.textContent = "Next";
      stepNextBtn.disabled = false;
    }
  }

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

bookingForm.addEventListener("input", refreshEstimate);

bookingForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (submitBookingBtn.disabled) return;

  if (settings.booking.allowPublicBooking === false) {
    showBookingMessage("Bookings are currently closed.", false);
    return;
  }

  submitBookingBtn.disabled = true;
  submitBookingBtn.textContent = "Submitting...";

  try {
    if (!(await validateBookingRules())) return;

    const formData = Object.fromEntries(new FormData(bookingForm).entries());
    const booking = {
      ...formData,
      cats: collectCats(),
      addOns: collectAddOns(),
    };

    const saved = await saveBooking(booking);

    availabilitySuite.value = formData.suiteType;
    bookingForm.reset();
    updateSuiteCardSelection();
    resetCatRows();
    refreshEstimate();
    showStep(0);
    showBookingMessage("", true);
    await renderAvailabilityCalendar();
    showAvailabilityMessage(
      `Booking submitted. Booking ID: ${saved.id} — we've emailed ${formData.ownerEmail} a copy, and we'll email again once it's confirmed. Keep the ID to look up this booking later.`,
      true,
    );
  } catch (err) {
    console.error("booking submission failed", err);
    showBookingMessage(err.message || "We could not save your booking. Please try again.", false);
  } finally {
    submitBookingBtn.textContent = "Confirm Reservation";
    submitBookingBtn.disabled = settings.booking.allowPublicBooking === false;
  }
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

  checkAvailabilityBtn.disabled = true;
  showAvailabilityMessage("Checking those dates...", true);

  try {
    const spaces = await spacesLeftInRange(start, end, suiteType);
    if (spaces > 0) {
      showAvailabilityMessage(
        `Great news. ${spaces} cat space${spaces === 1 ? "" : "s"} still available for those dates.`,
        true,
      );
    } else {
      showAvailabilityMessage("That period is fully booked. Try another date range.", false);
    }
    await renderAvailabilityCalendar();
  } catch (err) {
    showAvailabilityMessage(err.message || "Could not check availability. Please try again.", false);
  } finally {
    checkAvailabilityBtn.disabled = false;
  }
});

availabilitySuite.addEventListener("change", async () => {
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

function hidePageLoading() {
  const el = document.getElementById("page-loading");
  if (!el) return;
  el.classList.add("fade-out");
  setTimeout(() => {
    el.hidden = true;
  }, 220);
}

async function init() {
  try {
    settings = await getSettings();
    renderSelectOptions();
    renderPromoBanner(settings.promos);
    resetCatRows();
    applyBookingStatus();
    refreshEstimate();
    showStep(0);
    await renderAvailabilityCalendar();
  } finally {
    hidePageLoading();
  }
}

init();
