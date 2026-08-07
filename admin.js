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
};

const usernameInput = document.getElementById("admin-username");
const passwordInput = document.getElementById("admin-password");
const loginBtn = document.getElementById("admin-login");
const logoutBtn = document.getElementById("admin-logout");
const loginCardEl = document.getElementById("admin-login-card");
const statusEl = document.getElementById("admin-status");
const workspaceEl = document.getElementById("admin-workspace");
const workspaceStatusEl = document.getElementById("admin-workspace-status");
const upcomingRowsEl = document.getElementById("upcoming-bookings-rows");
const upcomingStatusEl = document.getElementById("upcoming-status");
const refreshUpcomingBtn = document.getElementById("refresh-upcoming");
const bookingSubtabsEl = document.getElementById("booking-subtabs");
const pendingCountEl = document.getElementById("count-pending");

let allBookings = [];
let activeBookingStatus = "pending";
const navEl = document.getElementById("admin-nav");
const navButtons = Array.from(document.querySelectorAll(".admin-nav-btn"));
const panels = Array.from(document.querySelectorAll(".admin-panel"));

const allowPublicBookingEl = document.getElementById("allow-public-booking");
const minNightsEl = document.getElementById("min-nights");
const maxNightsEl = document.getElementById("max-nights");

const suiteRowsEl = document.getElementById("suite-rows");
const addonRowsEl = document.getElementById("addon-rows");

const addSuiteBtn = document.getElementById("add-suite");
const addAddonBtn = document.getElementById("add-addon");
const saveSettingsBtn = document.getElementById("save-settings");
const saveBookingBtn = document.getElementById("save-booking");
const saveSuitesBtn = document.getElementById("save-suites");
const saveAddonsBtn = document.getElementById("save-addons");

function getAdminToken() {
  return localStorage.getItem("lb_admin_token") || "";
}

function setAdminToken(value) {
  localStorage.setItem("lb_admin_token", value);
}

function clearAdminToken() {
  localStorage.removeItem("lb_admin_token");
}

function showStatus(message, ok) {
  statusEl.textContent = message;
  statusEl.classList.remove("ok", "warn");
  statusEl.classList.add(ok ? "ok" : "warn");
}

function showWorkspaceStatus(message, ok) {
  workspaceStatusEl.textContent = message;
  workspaceStatusEl.classList.remove("ok", "warn");
  workspaceStatusEl.classList.add(ok ? "ok" : "warn");
}

function showUpcomingStatus(message, ok) {
  upcomingStatusEl.textContent = message;
  upcomingStatusEl.classList.remove("ok", "warn");
  upcomingStatusEl.classList.add(ok ? "ok" : "warn");
}

function setWorkspaceVisible(visible) {
  workspaceEl.hidden = !visible;
  saveSettingsBtn.disabled = !visible;
  addSuiteBtn.disabled = !visible;
  addAddonBtn.disabled = !visible;
  saveBookingBtn.disabled = !visible;
  saveSuitesBtn.disabled = !visible;
  saveAddonsBtn.disabled = !visible;
}

function setLoginCardVisible(visible) {
  loginCardEl.hidden = !visible;
}

function getAuthHeaders() {
  const token = getAdminToken();
  return token ? { "x-admin-token": token } : {};
}

function parseDate(dateString) {
  return new Date(`${dateString}T00:00:00`);
}

function formatMoney(value) {
  return new Intl.NumberFormat("ms-MY", {
    style: "currency",
    currency: "MYR",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function setActivePanel(panelId) {
  panels.forEach((panel) => {
    panel.hidden = panel.id !== panelId;
  });

  navButtons.forEach((button) => {
    const isActive = button.dataset.target === panelId;
    button.classList.toggle("active", isActive);
  });
}

function createCellInput(value, type = "text", step = "0.01") {
  const input = document.createElement("input");
  input.type = type;
  input.value = String(value ?? "");
  if (type === "number") {
    input.step = step;
    input.min = "0";
  }
  return input;
}

function createCellCheckbox(checked) {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = Boolean(checked);
  return input;
}

function createPreviewImage(url) {
  const img = document.createElement("img");
  img.className = "suite-preview-thumb";
  img.alt = "Suite preview";
  img.src = url || "";
  img.style.display = url ? "block" : "none";
  img.addEventListener("error", () => {
    img.style.display = "none";
  });
  return img;
}

function createDeleteButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "action-btn delete";
  button.textContent = "Delete";
  button.addEventListener("click", () => {
    button.closest("tr")?.remove();
  });
  return button;
}

function createTableRow(cells, labels = []) {
  const tr = document.createElement("tr");
  cells.forEach((cell, index) => {
    const td = document.createElement("td");
    const label = labels[index];
    if (label) td.dataset.label = label;
    td.appendChild(cell);
    tr.appendChild(td);
  });
  return tr;
}

function renderSuiteRows(suites) {
  suiteRowsEl.innerHTML = "";
  suites.forEach((suite) => {
    const imageUrlInput = createCellInput(suite.imageUrl || "");
    imageUrlInput.placeholder = "https://... or assets/suite.jpg";
    const preview = createPreviewImage(suite.imageUrl || "");
    imageUrlInput.addEventListener("input", () => {
      preview.src = imageUrlInput.value.trim();
      preview.style.display = imageUrlInput.value.trim() ? "block" : "none";
    });

    const row = createTableRow([
      createCellInput(suite.code),
      createCellInput(suite.name),
      createCellInput(suite.nightlyRate, "number"),
      createCellInput(suite.capacity, "number", "1"),
      imageUrlInput,
      preview,
      createCellCheckbox(suite.active),
      createDeleteButton(),
    ], ["Code", "Name", "Nightly Price (MYR)", "Capacity", "Image URL", "Preview", "Active", ""]);
    suiteRowsEl.appendChild(row);
  });
}

function renderAddonRows(addons) {
  addonRowsEl.innerHTML = "";
  addons.forEach((addon) => {
    const row = createTableRow([
      createCellInput(addon.code),
      createCellInput(addon.name),
      createCellInput(addon.flatFee, "number"),
      createCellInput(addon.nightlyFee, "number"),
      createCellCheckbox(addon.active),
      createDeleteButton(),
    ], ["Code", "Name", "Flat Fee (MYR)", "Nightly Fee (MYR)", "Active", ""]);
    addonRowsEl.appendChild(row);
  });
}

function collectSuiteRows() {
  return Array.from(suiteRowsEl.querySelectorAll("tr"))
    .map((row) => {
      const inputs = row.querySelectorAll("input");
      return {
        code: (inputs[0].value || "").trim(),
        name: (inputs[1].value || "").trim(),
        nightlyRate: Number(inputs[2].value) || 0,
        capacity: Math.max(1, Number(inputs[3].value) || 1),
        imageUrl: (inputs[4].value || "").trim(),
        active: inputs[5].checked,
      };
    })
    .filter((suite) => suite.code && suite.name);
}

function collectAddonRows() {
  return Array.from(addonRowsEl.querySelectorAll("tr"))
    .map((row) => {
      const inputs = row.querySelectorAll("input");
      return {
        code: (inputs[0].value || "").trim(),
        name: (inputs[1].value || "").trim(),
        flatFee: Number(inputs[2].value) || 0,
        nightlyFee: Number(inputs[3].value) || 0,
        active: inputs[4].checked,
      };
    })
    .filter((addon) => addon.code && addon.name);
}

async function fetchSettings() {
  const res = await fetch("/api/settings");
  if (!res.ok) return structuredClone(DEFAULT_SETTINGS);
  return await res.json();
}

async function fetchBookings() {
  const res = await fetch("/api/bookings");
  if (!res.ok) return [];
  return await res.json();
}

function catsLabel(row) {
  const cats = Array.isArray(row.cats) && row.cats.length
    ? row.cats
    : row.cat_name
      ? [{ name: row.cat_name, breed: row.breed, age: row.age }]
      : [];
  if (!cats.length) return "-";
  return cats.map((cat) => `${cat.name || "-"} (${cat.breed || "-"}, ${cat.age ?? "-"}y)`).join("; ");
}

function addOnsLabel(row) {
  const addOns = Array.isArray(row.add_ons) && row.add_ons.length
    ? row.add_ons
    : row.add_on
      ? [row.add_on]
      : [];
  return addOns.length ? addOns.join(", ") : "-";
}

function createBookingActionButton(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `action-btn ${className}`;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function createBookingActions(row) {
  const wrap = document.createElement("div");
  wrap.className = "booking-actions";

  if (row.status === "pending") {
    wrap.appendChild(createBookingActionButton("Approve", "approve", () => patchBookingStatus(row.id, "confirmed")));
    wrap.appendChild(createBookingActionButton("Reject", "delete", () => patchBookingStatus(row.id, "rejected")));
  } else if (row.status === "confirmed") {
    wrap.appendChild(createBookingActionButton("Mark Completed", "approve", () => patchBookingStatus(row.id, "completed")));
  }

  return wrap;
}

function renderBookingsTable(rows) {
  upcomingRowsEl.innerHTML = "";

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 9;
    td.textContent = "No bookings found in this category.";
    tr.appendChild(td);
    upcomingRowsEl.appendChild(tr);
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  rows.forEach((row) => {
    const ownerLabel = `${row.owner_name || "-"} (${row.owner_phone || "-"})`;
    const dateLabel = `${row.check_in || "-"} to ${row.check_out || "-"}`;

    const tr = createTableRow(
      [
        document.createTextNode(row.id || "-"),
        document.createTextNode(ownerLabel),
        document.createTextNode(catsLabel(row)),
        document.createTextNode(dateLabel),
        document.createTextNode(row.suite_type || "-"),
        document.createTextNode(addOnsLabel(row)),
        document.createTextNode(formatMoney(row.total_price)),
        document.createTextNode(row.notes || "-"),
        createBookingActions(row),
      ],
      ["Booking ID", "Owner", "Cats", "Stay Dates", "Suite", "Add-ons", "Total (MYR)", "Notes", "Actions"],
    );

    if (row.status === "confirmed" && row.check_out && parseDate(row.check_out) <= today) {
      tr.classList.add("booking-row-ready");
    }

    upcomingRowsEl.appendChild(tr);
  });
}

function setActiveBookingSubtab(status) {
  activeBookingStatus = status;
  if (bookingSubtabsEl) {
    Array.from(bookingSubtabsEl.querySelectorAll(".booking-subtab-btn")).forEach((button) => {
      button.classList.toggle("active", button.dataset.status === status);
    });
  }
  renderActiveBookingTab();
}

function renderActiveBookingTab() {
  const rows = allBookings
    .filter((row) => (row.status || "pending") === activeBookingStatus)
    .sort((a, b) => parseDate(a.check_in || "2100-01-01") - parseDate(b.check_in || "2100-01-01"));

  renderBookingsTable(rows);
  showUpcomingStatus(`Showing ${rows.length} ${activeBookingStatus} booking(s).`, true);
}

async function loadUpcomingBookings() {
  allBookings = await fetchBookings();

  if (pendingCountEl) {
    const pendingCount = allBookings.filter((row) => (row.status || "pending") === "pending").length;
    pendingCountEl.textContent = pendingCount ? `(${pendingCount})` : "";
  }

  renderActiveBookingTab();
}

async function patchBookingStatus(id, status) {
  showUpcomingStatus("Updating booking...", true);
  try {
    const res = await fetch(`/api/bookings?id=${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ status }),
    });

    if (!res.ok) {
      const errorBody = await res.json().catch(() => null);
      showUpcomingStatus(errorBody?.error || "Failed to update booking.", false);
      return;
    }

    showUpcomingStatus(`Booking ${id} updated to ${status}.`, true);
    await loadUpcomingBookings();
  } catch (err) {
    showUpcomingStatus("Failed to update booking.", false);
  }
}

async function enterWorkspace() {
  setLoginCardVisible(false);
  setWorkspaceVisible(true);
  setActivePanel("panel-upcoming");
  const settings = await fetchSettings();
  applySettingsToForm(settings);
  await loadUpcomingBookings();
}

async function login() {
  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  if (!username || !password) {
    showStatus("Please enter both username and password.", false);
    return;
  }

  const res = await fetch("/api/admin-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    showStatus("Invalid admin credentials.", false);
    setWorkspaceVisible(false);
    return;
  }

  const data = await res.json();
  setAdminToken(data.token);
  passwordInput.value = "";
  showStatus("Signed in as administrator.", true);
  await enterWorkspace();
}

async function restoreSession() {
  const token = getAdminToken();
  if (!token) return false;

  const res = await fetch("/api/admin-login", {
    method: "GET",
    headers: getAuthHeaders(),
  });

  if (!res.ok) {
    clearAdminToken();
    return false;
  }

  await enterWorkspace();
  return true;
}

function logout() {
  clearAdminToken();
  setLoginCardVisible(true);
  setWorkspaceVisible(false);
  passwordInput.value = "";
  showStatus("You are signed out.", false);
}

function applySettingsToForm(settings) {
  allowPublicBookingEl.value = settings.booking?.allowPublicBooking === false ? "false" : "true";
  minNightsEl.value = String(settings.booking?.minNights || 1);
  maxNightsEl.value = String(settings.booking?.maxNights || 30);
  renderSuiteRows(settings.suites || []);
  renderAddonRows(settings.addons || []);
}

function collectSettingsFromForm() {
  return {
    booking: {
      allowPublicBooking: allowPublicBookingEl.value !== "false",
      minNights: Math.max(1, Number(minNightsEl.value) || 1),
      maxNights: Math.max(1, Number(maxNightsEl.value) || 30),
    },
    suites: collectSuiteRows(),
    addons: collectAddonRows(),
  };
}

async function saveSettings() {
  const adminToken = getAdminToken();
  if (!adminToken) {
    showStatus("Please sign in before saving settings.", false);
    return;
  }

  const settings = collectSettingsFromForm();
  if (settings.booking.maxNights < settings.booking.minNights) {
    showStatus("Maximum nights cannot be lower than minimum nights.", false);
    return;
  }

  if (!settings.suites.length) {
    showStatus("At least one suite is required.", false);
    return;
  }

  const res = await fetch("/api/settings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
    },
    body: JSON.stringify(settings),
  });

  if (res.ok) {
    showWorkspaceStatus("Settings saved successfully.", true);
  } else if (res.status === 401) {
    logout();
    showStatus("Session expired. Please sign in again.", false);
  } else {
    const errorBody = await res.json().catch(() => null);
    const detail = errorBody?.detail || errorBody?.error || "Check backend logs/table setup.";
    showWorkspaceStatus(`Failed to save settings. ${detail}`, false);
  }
}

loginBtn.addEventListener("click", login);

passwordInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    login();
  }
});

logoutBtn.addEventListener("click", logout);

if (navEl) {
  navEl.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const panelId = target.dataset.target;
    if (!panelId) return;
    setActivePanel(panelId);
  });
}

refreshUpcomingBtn.addEventListener("click", loadUpcomingBookings);

if (bookingSubtabsEl) {
  bookingSubtabsEl.addEventListener("click", (event) => {
    const target = event.target.closest(".booking-subtab-btn");
    if (!target) return;
    setActiveBookingSubtab(target.dataset.status);
  });
}

addSuiteBtn.addEventListener("click", () => {
  const imageUrlInput = createCellInput("");
  imageUrlInput.placeholder = "https://... or assets/suite.jpg";
  const preview = createPreviewImage("");
  imageUrlInput.addEventListener("input", () => {
    preview.src = imageUrlInput.value.trim();
    preview.style.display = imageUrlInput.value.trim() ? "block" : "none";
  });

  const row = createTableRow([
    createCellInput("suite-code"),
    createCellInput("Suite Name"),
    createCellInput(0, "number"),
    createCellInput(1, "number", "1"),
    imageUrlInput,
    preview,
    createCellCheckbox(true),
    createDeleteButton(),
  ], ["Code", "Name", "Nightly Price (MYR)", "Capacity", "Image URL", "Preview", "Active", ""]);
  suiteRowsEl.appendChild(row);
});

addAddonBtn.addEventListener("click", () => {
  const row = createTableRow([
    createCellInput("addon-code"),
    createCellInput("Add-on Name"),
    createCellInput(0, "number"),
    createCellInput(0, "number"),
    createCellCheckbox(true),
    createDeleteButton(),
  ], ["Code", "Name", "Flat Fee (MYR)", "Nightly Fee (MYR)", "Active", ""]);
  addonRowsEl.appendChild(row);
});

saveSettingsBtn.addEventListener("click", saveSettings);
saveBookingBtn.addEventListener("click", saveSettings);
saveSuitesBtn.addEventListener("click", saveSettings);
saveAddonsBtn.addEventListener("click", saveSettings);

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
    setWorkspaceVisible(false);
    setActivePanel("panel-upcoming");

    const restored = await restoreSession();
    if (!restored) {
      setLoginCardVisible(true);
    }
  } finally {
    hidePageLoading();
  }
}

init();
