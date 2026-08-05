const lookupForm = document.getElementById("lookup-form");
const bookingIdInput = document.getElementById("lookup-booking-id");
const emailInput = document.getElementById("lookup-email");
const statusEl = document.getElementById("lookup-status");
const resultEl = document.getElementById("lookup-result");
const summaryEl = document.getElementById("lookup-summary");

function formatMoney(value) {
  return new Intl.NumberFormat("ms-MY", {
    style: "currency",
    currency: "MYR",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function showStatus(message, ok) {
  statusEl.textContent = message;
  statusEl.classList.remove("ok", "warn");
  statusEl.classList.add(ok ? "ok" : "warn");
}

function catsLabel(booking) {
  const cats = Array.isArray(booking.cats) && booking.cats.length
    ? booking.cats
    : booking.cat_name
      ? [{ name: booking.cat_name, breed: booking.breed, age: booking.age }]
      : [];
  if (!cats.length) return "-";
  return cats.map((cat) => `${cat.name || "-"} (${cat.breed || "-"}, ${cat.age ?? "-"}y)`).join("; ");
}

function addOnsLabel(booking) {
  const addOns = Array.isArray(booking.add_ons) && booking.add_ons.length
    ? booking.add_ons
    : booking.add_on
      ? [booking.add_on]
      : [];
  return addOns.length ? addOns.join(", ") : "None";
}

function renderBooking(booking) {
  const rows = [
    ["Booking ID", booking.id],
    ["Owner", `${booking.owner_name || "-"} · ${booking.owner_phone || "-"}`],
    ["Cats", catsLabel(booking)],
    ["Stay", `${booking.check_in} to ${booking.check_out}`],
    ["Suite", booking.suite_type || "-"],
    ["Add-ons", addOnsLabel(booking)],
    ["Total", formatMoney(booking.total_price)],
  ];
  if (booking.notes) rows.push(["Notes", booking.notes]);

  summaryEl.innerHTML = "";
  rows.forEach(([label, value]) => {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    summaryEl.append(dt, dd);
  });

  resultEl.hidden = false;
}

lookupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  resultEl.hidden = true;

  const res = await fetch("/api/booking-lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bookingId: bookingIdInput.value.trim(),
      email: emailInput.value,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    showStatus(data.error || "No booking found matching that ID and email.", false);
    return;
  }

  showStatus("Booking found.", true);
  renderBooking(data);
});
