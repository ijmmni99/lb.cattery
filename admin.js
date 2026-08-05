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

const keyInput = document.getElementById("admin-key");
const saveKeyBtn = document.getElementById("save-admin-key");
const reloadBtn = document.getElementById("load-settings");
const statusEl = document.getElementById("admin-status");

const allowPublicBookingEl = document.getElementById("allow-public-booking");
const minNightsEl = document.getElementById("min-nights");
const maxNightsEl = document.getElementById("max-nights");

const suiteRowsEl = document.getElementById("suite-rows");
const addonRowsEl = document.getElementById("addon-rows");

const addSuiteBtn = document.getElementById("add-suite");
const addAddonBtn = document.getElementById("add-addon");
const saveSettingsBtn = document.getElementById("save-settings");

function getAdminKey() {
  return localStorage.getItem("lb_admin_key") || "";
}

function setAdminKey(value) {
  localStorage.setItem("lb_admin_key", value);
}

function showStatus(message, ok) {
  statusEl.textContent = message;
  statusEl.classList.remove("ok", "warn");
  statusEl.classList.add(ok ? "ok" : "warn");
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

function createTableRow(cells) {
  const tr = document.createElement("tr");
  cells.forEach((cell) => {
    const td = document.createElement("td");
    td.appendChild(cell);
    tr.appendChild(td);
  });
  return tr;
}

function renderSuiteRows(suites) {
  suiteRowsEl.innerHTML = "";
  suites.forEach((suite) => {
    const row = createTableRow([
      createCellInput(suite.code),
      createCellInput(suite.name),
      createCellInput(suite.nightlyRate, "number"),
      createCellInput(suite.capacity, "number", "1"),
      createCellCheckbox(suite.active),
    ]);
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
    ]);
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
        active: inputs[4].checked,
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
  const adminKey = getAdminKey();
  if (!adminKey) {
    showStatus("Enter and save the admin key first.", false);
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
      "x-admin-key": adminKey,
    },
    body: JSON.stringify(settings),
  });

  if (res.ok) {
    showStatus("Settings saved successfully.", true);
  } else if (res.status === 401) {
    showStatus("Admin key is invalid.", false);
  } else {
    showStatus("Failed to save settings. Check backend logs/table setup.", false);
  }
}

saveKeyBtn.addEventListener("click", () => {
  const key = keyInput.value.trim();
  if (!key) {
    showStatus("Please enter a key before saving.", false);
    return;
  }
  setAdminKey(key);
  keyInput.value = "";
  showStatus("Admin key saved in this browser.", true);
});

reloadBtn.addEventListener("click", async () => {
  const settings = await fetchSettings();
  applySettingsToForm(settings);
  showStatus("Settings reloaded from backend.", true);
});

addSuiteBtn.addEventListener("click", () => {
  const row = createTableRow([
    createCellInput("suite-code"),
    createCellInput("Suite Name"),
    createCellInput(0, "number"),
    createCellInput(1, "number", "1"),
    createCellCheckbox(true),
  ]);
  suiteRowsEl.appendChild(row);
});

addAddonBtn.addEventListener("click", () => {
  const row = createTableRow([
    createCellInput("addon-code"),
    createCellInput("Add-on Name"),
    createCellInput(0, "number"),
    createCellInput(0, "number"),
    createCellCheckbox(true),
  ]);
  addonRowsEl.appendChild(row);
});

saveSettingsBtn.addEventListener("click", saveSettings);

async function init() {
  const currentKey = getAdminKey();
  if (currentKey) {
    showStatus("Admin key loaded from browser storage.", true);
  } else {
    showStatus("Set your admin key to enable save actions.", false);
  }

  const settings = await fetchSettings();
  applySettingsToForm(settings);
}

init();
