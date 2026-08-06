const authCard = document.getElementById("user-auth-card");
const workspace = document.getElementById("user-workspace");
const authStatus = document.getElementById("user-auth-status");
const bookingsStatus = document.getElementById("user-bookings-status");
const userWelcome = document.getElementById("user-welcome");

const authSwitch = document.querySelector(".auth-switch");
const loginForm = document.getElementById("login-form");
const signupForm = document.getElementById("signup-form");
const forgotForm = document.getElementById("forgot-form");
const resetForm = document.getElementById("reset-form");
const showLoginBtn = document.getElementById("show-login");
const showSignupBtn = document.getElementById("show-signup");
const showForgotLink = document.getElementById("show-forgot");
const showLoginFromForgotLink = document.getElementById("show-login-from-forgot");

const loginEmail = document.getElementById("login-email");
const loginPassword = document.getElementById("login-password");

const signupName = document.getElementById("signup-name");
const signupPhone = document.getElementById("signup-phone");
const signupEmail = document.getElementById("signup-email");
const signupPassword = document.getElementById("signup-password");

const forgotEmail = document.getElementById("forgot-email");
const resetPassword = document.getElementById("reset-password");
let activeResetToken = "";

const refreshBtn = document.getElementById("refresh-user-bookings");
const logoutBtn = document.getElementById("user-logout");
const bookingsList = document.getElementById("user-bookings-list");

function formatMoney(value) {
  return new Intl.NumberFormat("ms-MY", {
    style: "currency",
    currency: "MYR",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function setAuthStatus(message, ok) {
  authStatus.textContent = message;
  authStatus.classList.remove("ok", "warn");
  authStatus.classList.add(ok ? "ok" : "warn");
}

function setBookingsStatus(message, ok) {
  bookingsStatus.textContent = message;
  bookingsStatus.classList.remove("ok", "warn");
  bookingsStatus.classList.add(ok ? "ok" : "warn");
}

function extractApiErrorMessage(data, fallback) {
  if (!data || typeof data !== "object") return fallback;
  const parts = [];
  if (data.error) parts.push(String(data.error));
  if (data.hint) parts.push(`Hint: ${String(data.hint)}`);
  if (data.status) parts.push(`Status: ${String(data.status)}`);
  if (data.detail) {
    const detailText = String(data.detail).replace(/\s+/g, " ").trim();
    if (detailText) parts.push(`Detail: ${detailText.slice(0, 220)}`);
  }
  return parts.length ? parts.join(" | ") : fallback;
}

function setMode(mode) {
  loginForm.hidden = mode !== "login";
  signupForm.hidden = mode !== "signup";
  forgotForm.hidden = mode !== "forgot";
  resetForm.hidden = mode !== "reset";

  const showTabs = mode === "login" || mode === "signup";
  authSwitch.hidden = !showTabs;
  if (showTabs) {
    const isLogin = mode === "login";
    showLoginBtn.classList.toggle("active", isLogin);
    showSignupBtn.classList.toggle("active", !isLogin);
    showLoginBtn.classList.toggle("secondary", !isLogin);
    showSignupBtn.classList.toggle("secondary", isLogin);
  }
}

function getToken() {
  return localStorage.getItem("lb_user_token") || "";
}

function setToken(token) {
  localStorage.setItem("lb_user_token", token);
}

function clearSession() {
  localStorage.removeItem("lb_user_token");
  localStorage.removeItem("lb_user_name");
  localStorage.removeItem("lb_user_email");
}

function showAuthenticatedUi(name, email) {
  authCard.hidden = true;
  workspace.hidden = false;
  const label = name ? `${name} (${email})` : email;
  userWelcome.textContent = `Signed in as ${label}`;
}

function showLoggedOutUi() {
  authCard.hidden = false;
  workspace.hidden = true;
}

async function verifySession() {
  const token = getToken();
  if (!token) return false;

  const res = await fetch("/api/user-auth", {
    method: "GET",
    headers: { "x-user-token": token },
  });

  if (!res.ok) return false;
  const data = await res.json();
  localStorage.setItem("lb_user_name", data.name || "");
  localStorage.setItem("lb_user_email", data.email || "");
  return true;
}

const BOOKING_ROW_LABELS = ["Booking ID", "Cats", "Dates", "Suite", "Add-ons", "Total (MYR)", "Notes"];

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

function renderBookings(rows) {
  bookingsList.innerHTML = "";

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 7;
    td.textContent = "No bookings found for your account email yet.";
    tr.appendChild(td);
    bookingsList.appendChild(tr);
    return;
  }

  rows.forEach((row) => {
    const dateLabel = `${row.check_in} to ${row.check_out}`;
    const values = [
      row.id,
      catsLabel(row),
      dateLabel,
      row.suite_type || "-",
      addOnsLabel(row),
      formatMoney(row.total_price),
      row.notes || "-",
    ];

    const tr = document.createElement("tr");
    values.forEach((value, index) => {
      const td = document.createElement("td");
      td.dataset.label = BOOKING_ROW_LABELS[index];
      td.textContent = value;
      tr.appendChild(td);
    });
    bookingsList.appendChild(tr);
  });
}

async function loadMyBookings() {
  const token = getToken();
  if (!token) return;

  const res = await fetch("/api/user-bookings", {
    headers: { "x-user-token": token },
  });

  if (res.status === 401) {
    clearSession();
    showLoggedOutUi();
    setAuthStatus("Session expired. Please sign in again.", false);
    return;
  }

  if (!res.ok) {
    setBookingsStatus("Failed to load bookings.", false);
    return;
  }

  const rows = await res.json();
  renderBookings(Array.isArray(rows) ? rows : []);
  setBookingsStatus("Bookings loaded.", true);
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const res = await fetch("/api/user-auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "login",
      email: loginEmail.value,
      password: loginPassword.value,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) {
    setAuthStatus(extractApiErrorMessage(data, "Login failed."), false);
    return;
  }

  setToken(data.token);
  localStorage.setItem("lb_user_name", data.user?.fullName || "");
  localStorage.setItem("lb_user_email", data.user?.email || "");
  loginPassword.value = "";

  showAuthenticatedUi(data.user?.fullName || "", data.user?.email || "");
  setAuthStatus("Signed in successfully.", true);
  await loadMyBookings();
});

signupForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const res = await fetch("/api/user-auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "signup",
      fullName: signupName.value,
      phone: signupPhone.value,
      email: signupEmail.value,
      password: signupPassword.value,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) {
    setAuthStatus(extractApiErrorMessage(data, "Sign up failed."), false);
    return;
  }

  setToken(data.token);
  localStorage.setItem("lb_user_name", data.user?.fullName || "");
  localStorage.setItem("lb_user_email", data.user?.email || "");
  signupPassword.value = "";

  showAuthenticatedUi(data.user?.fullName || "", data.user?.email || "");
  setAuthStatus("Account created and signed in.", true);
  await loadMyBookings();
});

forgotForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const res = await fetch("/api/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "request", email: forgotEmail.value }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    setAuthStatus(extractApiErrorMessage(data, "Failed to send reset link."), false);
    return;
  }

  forgotForm.reset();
  setAuthStatus(data.message || "If that email is registered, a reset link has been sent.", true);
});

resetForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const res = await fetch("/api/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "confirm", token: activeResetToken, password: resetPassword.value }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    setAuthStatus(extractApiErrorMessage(data, "Failed to reset password."), false);
    return;
  }

  resetForm.reset();
  window.history.replaceState({}, "", "user-login.html");
  setMode("login");
  setAuthStatus("Password updated. Please sign in with your new password.", true);
});

showLoginBtn.addEventListener("click", () => setMode("login"));
showSignupBtn.addEventListener("click", () => setMode("signup"));

showForgotLink.addEventListener("click", (event) => {
  event.preventDefault();
  setMode("forgot");
});

showLoginFromForgotLink.addEventListener("click", (event) => {
  event.preventDefault();
  setMode("login");
});

refreshBtn.addEventListener("click", loadMyBookings);

logoutBtn.addEventListener("click", () => {
  clearSession();
  showLoggedOutUi();
  setAuthStatus("You are signed out.", false);
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
    const resetToken = new URLSearchParams(window.location.search).get("reset");
    if (resetToken) {
      activeResetToken = resetToken;
      setMode("reset");
      return;
    }

    setMode("login");
    const valid = await verifySession();
    if (!valid) {
      clearSession();
      showLoggedOutUi();
      return;
    }

    const name = localStorage.getItem("lb_user_name") || "";
    const email = localStorage.getItem("lb_user_email") || "";
    showAuthenticatedUi(name, email);
    setAuthStatus("Signed in with existing session.", true);
    await loadMyBookings();
  } finally {
    hidePageLoading();
  }
}

init();
