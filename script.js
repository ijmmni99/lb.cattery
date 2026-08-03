const STORAGE_KEY = "lb-cattery-bookings";

const pricing = {
  suites: {
    standard: 20,
    deluxe: 35,
    royal: 55,
  },
  addOnFlat: {
    none: 0,
    grooming: 18,
    medication: 12,
  },
  addOnNightly: {
    playtime: 10,
  },
};

const suiteCapacity = {
  standard: 6,
  deluxe: 4,
  royal: 2,
};

const bookingForm = document.getElementById("booking-form");
const estimatedTotalEl = document.getElementById("estimated-total");
const listEl = document.getElementById("reservation-list");
const rowTemplate = document.getElementById("reservation-row-template");
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
const submitBookingBtn = document.getElementById("submit-booking");
const cancelEditBtn = document.getElementById("cancel-edit");
const formModeEl = document.getElementById("form-mode");

let editingBookingId = null;
const calendarState = {
  year: new Date().getFullYear(),
  month: new Date().getMonth(),
};

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

function getBookings() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
}

function saveBookings(bookings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bookings));
}

function datesOverlap(aStart, aEnd, bStart, bEnd) {
  const startA = parseDate(aStart);
  const endA = parseDate(aEnd);
  const startB = parseDate(bStart);
  const endB = parseDate(bEnd);
  return startA < endB && endA > startB;
}

function isDateRangeAvailable(start, end, suiteType, currentBookings = getBookings()) {
  const overlapsInSuite = currentBookings.filter(
    (booking) => booking.suiteType === suiteType && datesOverlap(start, end, booking.checkIn, booking.checkOut),
  ).length;
  return overlapsInSuite < (suiteCapacity[suiteType] || 1);
}

function calculateEstimate(formData) {
  const nights = Math.max(0, daysBetween(formData.checkIn, formData.checkOut));
  const suiteRate = pricing.suites[formData.suiteType] || 0;
  const addOnFlat = pricing.addOnFlat[formData.addOn] || 0;
  const addOnNightly = pricing.addOnNightly[formData.addOn] || 0;
  return suiteRate * nights + addOnFlat + addOnNightly * nights;
}

function renderBookings() {
  const bookings = getBookings().sort((a, b) => parseDate(a.checkIn) - parseDate(b.checkIn));
  listEl.innerHTML = "";

  if (!bookings.length) {
    const row = document.createElement("tr");
    row.innerHTML = '<td colspan="8">No reservations yet.</td>';
    listEl.appendChild(row);
    return;
  }

  for (const booking of bookings) {
    const fragment = rowTemplate.content.cloneNode(true);
    fragment.querySelector('[data-key="id"]').textContent = booking.id;
    fragment.querySelector('[data-key="owner"]').textContent = `${booking.ownerName} (${booking.ownerPhone})`;
    fragment.querySelector('[data-key="cat"]').textContent = `${booking.catName} • ${booking.breed} • ${booking.age}y`;
    fragment.querySelector('[data-key="dates"]').textContent = `${booking.checkIn} to ${booking.checkOut}`;
    fragment.querySelector('[data-key="suite"]').textContent = booking.suiteType;
    fragment.querySelector('[data-key="total"]').textContent = formatMoney(booking.totalPrice);
    fragment.querySelector('[data-key="notes"]').textContent = booking.notes || "-";

    fragment.querySelector('[data-key="id"]').setAttribute("data-label", "Booking ID");
    fragment.querySelector('[data-key="owner"]').setAttribute("data-label", "Owner");
    fragment.querySelector('[data-key="cat"]').setAttribute("data-label", "Cat");
    fragment.querySelector('[data-key="dates"]').setAttribute("data-label", "Dates");
    fragment.querySelector('[data-key="suite"]').setAttribute("data-label", "Suite");
    fragment.querySelector('[data-key="total"]').setAttribute("data-label", "Total");
    fragment.querySelector('[data-key="notes"]').setAttribute("data-label", "Notes");

    const actionsCell = fragment.querySelector('[data-key="actions"]');
    actionsCell.setAttribute("data-label", "Actions");
    const actionWrap = document.createElement("div");
    actionWrap.className = "row-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "action-btn";
    editBtn.textContent = "Edit";
    editBtn.dataset.id = booking.id;
    editBtn.dataset.action = "edit";

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "action-btn delete";
    deleteBtn.textContent = "Cancel";
    deleteBtn.dataset.id = booking.id;
    deleteBtn.dataset.action = "delete";

    actionWrap.append(editBtn, deleteBtn);
    actionsCell.appendChild(actionWrap);

    listEl.appendChild(fragment);
  }
}

function setFormMode(isEditing) {
  if (isEditing) {
    formModeEl.textContent = "Edit mode is active. Save changes to update the reservation.";
    submitBookingBtn.textContent = "Save Changes";
    cancelEditBtn.hidden = false;
  } else {
    formModeEl.textContent = "You are creating a new booking.";
    submitBookingBtn.textContent = "Confirm Reservation";
    cancelEditBtn.hidden = true;
  }
}

function enterEditMode(bookingId) {
  const booking = getBookings().find((item) => item.id === bookingId);
  if (!booking) return;

  for (const [key, value] of Object.entries(booking)) {
    const field = bookingForm.elements.namedItem(key);
    if (field) field.value = value;
  }

  editingBookingId = bookingId;
  setFormMode(true);
  refreshEstimate();
  bookingForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function clearEditMode() {
  editingBookingId = null;
  bookingForm.reset();
  setFormMode(false);
  refreshEstimate();
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

function bookingCountForDate(dateIso, suiteType) {
  return getBookings().filter(
    (booking) => booking.suiteType === suiteType && dateIso >= booking.checkIn && dateIso < booking.checkOut,
  ).length;
}

function dayClassByCount(count, suiteType) {
  const cap = suiteCapacity[suiteType] || 1;
  if (count >= cap) return "full";
  if (count > 0) return "limited";
  return "available";
}

function renderAvailabilityCalendar() {
  const suiteType = availabilitySuite.value;
  const { year, month } = calendarState;
  const { start, end } = getMonthBounds(year, month);
  const firstWeekday = start.getDay();
  const daysInMonth = end.getDate();

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
    const count = bookingCountForDate(isoDate, suiteType);

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

function renderBlockedRanges(suiteType) {
  const bookings = getBookings()
    .filter((booking) => booking.suiteType === suiteType)
    .sort((a, b) => parseDate(a.checkIn) - parseDate(b.checkIn));

  if (!bookings.length) {
    blockedRangesEl.innerHTML = "<strong>Booked date blocks:</strong> none yet for this suite.";
    return;
  }

  const items = bookings
    .slice(0, 6)
    .map(
      (booking) =>
        `<li>${booking.checkIn} to ${booking.checkOut} (${booking.catName})</li>`,
    )
    .join("");

  blockedRangesEl.innerHTML = `<strong>Booked date blocks:</strong><ul>${items}</ul>`;
}

function syncAvailabilitySuiteFromLatestBooking() {
  const bookings = getBookings();
  if (!bookings.length) return;
  const latest = bookings.sort((a, b) => parseDate(b.checkIn) - parseDate(a.checkIn))[0];
  if (latest?.suiteType) {
    availabilitySuite.value = latest.suiteType;
  }
}

bookingForm.addEventListener("input", refreshEstimate);

bookingForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = Object.fromEntries(new FormData(bookingForm).entries());

  if (parseDate(formData.checkOut) <= parseDate(formData.checkIn)) {
    alert("Check-out date must be after check-in date.");
    return;
  }

  const bookings = getBookings();
  const bookingsExcludingCurrent = editingBookingId
    ? bookings.filter((booking) => booking.id !== editingBookingId)
    : bookings;

  if (!isDateRangeAvailable(formData.checkIn, formData.checkOut, formData.suiteType, bookingsExcludingCurrent)) {
    alert("Those dates are currently unavailable. Please choose another range.");
    return;
  }

  if (editingBookingId) {
    const index = bookings.findIndex((booking) => booking.id === editingBookingId);
    if (index !== -1) {
      bookings[index] = {
        ...bookings[index],
        ...formData,
        totalPrice: calculateEstimate(formData),
        updatedAt: new Date().toISOString(),
      };
      saveBookings(bookings);
      showAvailabilityMessage("Reservation updated successfully.", true);
    }
    availabilitySuite.value = formData.suiteType;
    clearEditMode();
  } else {
    const booking = {
      ...formData,
      id: `LB-${Date.now().toString().slice(-6)}`,
      totalPrice: calculateEstimate(formData),
      createdAt: new Date().toISOString(),
    };

    bookings.push(booking);
    saveBookings(bookings);
    availabilitySuite.value = formData.suiteType;
    bookingForm.reset();
    showAvailabilityMessage("Reservation confirmed and dates are now blocked.", true);
  }

  refreshEstimate();
  renderBookings();
  renderBlockedRanges(availabilitySuite.value);
  renderAvailabilityCalendar();
});

checkAvailabilityBtn.addEventListener("click", () => {
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

  const available = isDateRangeAvailable(start, end, suiteType);
  if (available) {
    showAvailabilityMessage(`Great news. Those dates are currently available for ${suiteType} suite.`, true);
  } else {
    showAvailabilityMessage(`That period is fully booked for ${suiteType} suite. Try another date range.`, false);
  }

  renderBlockedRanges(suiteType);
  renderAvailabilityCalendar();
});

availabilitySuite.addEventListener("change", () => {
  renderBlockedRanges(availabilitySuite.value);
  renderAvailabilityCalendar();
});

listEl.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const action = target.dataset.action;
  const bookingId = target.dataset.id;
  if (!action || !bookingId) return;

  if (action === "edit") {
    enterEditMode(bookingId);
    return;
  }

  if (action === "delete") {
    const confirmed = window.confirm("Cancel this reservation?");
    if (!confirmed) return;
    const bookings = getBookings().filter((booking) => booking.id !== bookingId);
    saveBookings(bookings);
    if (editingBookingId === bookingId) clearEditMode();
    renderBookings();
    renderBlockedRanges(availabilitySuite.value);
    renderAvailabilityCalendar();
    showAvailabilityMessage("Reservation cancelled.", true);
  }
});

cancelEditBtn.addEventListener("click", () => {
  clearEditMode();
});

calPrevBtn.addEventListener("click", () => {
  calendarState.month -= 1;
  if (calendarState.month < 0) {
    calendarState.month = 11;
    calendarState.year -= 1;
  }
  renderAvailabilityCalendar();
});

calNextBtn.addEventListener("click", () => {
  calendarState.month += 1;
  if (calendarState.month > 11) {
    calendarState.month = 0;
    calendarState.year += 1;
  }
  renderAvailabilityCalendar();
});

refreshEstimate();
syncAvailabilitySuiteFromLatestBooking();
renderBookings();
renderBlockedRanges(availabilitySuite.value);
renderAvailabilityCalendar();
setFormMode(false);
