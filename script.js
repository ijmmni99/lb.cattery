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

const STEP_LABELS = ["Suite & Dates", "Cat Details", "Contact Info", "Review & Confirm"];
let currentStep = 0;

const calendarState = {
  year: new Date().getFullYear(),
  month: new Date().getMonth(),
};

let calendarBookingsCache = [];
let activeCalendarDay = null;

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
    cats: Array.isArray(r.cats) && r.cats.length
      ? r.cats
      : r.cat_name
        ? [{ name: r.cat_name, breed: r.breed, age: r.age }]
        : [],
    suiteType: r.suite_type,
    checkIn: r.check_in,
    checkOut: r.check_out,
    addOns: Array.isArray(r.add_ons) && r.add_ons.length
      ? r.add_ons
      : r.add_on
        ? [r.add_on]
        : [],
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
      cats: booking.cats,
      suite_type: booking.suiteType,
      check_in: booking.checkIn,
      check_out: booking.checkOut,
      add_ons: booking.addOns,
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
    if (index === 0) radio.checked = true;

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

async function isDateRangeAvailable(start, end, suiteType, currentBookings = null) {
  const suiteCapacity = getSuiteCapacityMap();
  const bookings = currentBookings ?? await getBookings();
  const overlapsInSuite = bookings.filter(
    (booking) => booking.suiteType === suiteType && datesOverlap(start, end, booking.checkIn, booking.checkOut),
  ).length;
  return overlapsInSuite < (suiteCapacity[suiteType] || 1);
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
  calendarBookingsCache = allBookings;
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

  for (let day = 1; day <= daysInMonth; day += 1) {
    const isoDate = isoDateFromParts(year, month, day);
    const count = bookingCountForDate(isoDate, suiteType, allBookings);

    const dayEl = document.createElement("button");
    dayEl.type = "button";
    dayEl.className = `calendar-day ${dayClassByCount(count, suiteType)}`;
    dayEl.dataset.date = isoDate;
    dayEl.setAttribute("aria-haspopup", "dialog");
    dayEl.setAttribute(
      "aria-label",
      `${formatDateLong(isoDate)}: ${count > 0 ? `${count} booking${count > 1 ? "s" : ""}` : "no bookings"}. Tap for summary.`,
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

function bookingsSummaryForDate(dateIso, allBookings) {
  const matches = allBookings.filter((booking) => dateIso >= booking.checkIn && dateIso < booking.checkOut);
  const bySuite = new Map();
  matches.forEach((booking) => {
    const suite = suiteByCode(booking.suiteType);
    const label = suite ? suite.name : booking.suiteType;
    bySuite.set(label, (bySuite.get(label) || 0) + 1);
  });
  return { total: matches.length, bySuite };
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
    empty.textContent = "No bookings on this date.";
    calendarPopover.appendChild(empty);
  } else {
    const summaryLine = document.createElement("p");
    summaryLine.className = "popover-total";
    summaryLine.textContent = `${total} booking${total > 1 ? "s" : ""} total`;

    const list = document.createElement("ul");
    bySuite.forEach((count, label) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = label;
      const num = document.createElement("span");
      num.textContent = `${count} booking${count > 1 ? "s" : ""}`;
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

bookingForm.addEventListener("input", refreshEstimate);

bookingForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (settings.booking.allowPublicBooking === false) {
    alert("Bookings are currently closed.");
    return;
  }

  if (!(await validateBookingRules())) return;

  const formData = Object.fromEntries(new FormData(bookingForm).entries());
  const addOns = collectAddOns();
  const cats = collectCats();
  const booking = {
    ...formData,
    cats,
    addOns,
    id: `LB-${Date.now().toString().slice(-6)}`,
    totalPrice: calculateEstimate(formData, addOns, cats.length),
  };

  await saveBooking(booking);
  availabilitySuite.value = formData.suiteType;
  bookingForm.reset();
  resetCatRows();
  refreshEstimate();
  showStep(0);
  await renderAvailabilityCalendar();
  showAvailabilityMessage(
    `Booking submitted. Booking ID: ${booking.id} — we'll review it and email ${booking.ownerEmail} once it's confirmed. Keep the ID to look up this booking later.`,
    true,
  );
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

  await renderAvailabilityCalendar();
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
