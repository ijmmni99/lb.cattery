const authCard = document.getElementById("user-auth-card");
const workspace = document.getElementById("user-workspace");
const authStatus = document.getElementById("user-auth-status");
const bookingsStatus = document.getElementById("user-bookings-status");
const userWelcome = document.getElementById("user-welcome");

const loginForm = document.getElementById("login-form");
const signupForm = document.getElementById("signup-form");
const showLoginBtn = document.getElementById("show-login");
const showSignupBtn = document.getElementById("show-signup");

const loginEmail = document.getElementById("login-email");
const loginPassword = document.getElementById("login-password");

const signupName = document.getElementById("signup-name");
const signupPhone = document.getElementById("signup-phone");
const signupEmail = document.getElementById("signup-email");
const signupPassword = document.getElementById("signup-password");

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
  const isLogin = mode === "login";
  loginForm.hidden = !isLogin;
  signupForm.hidden = isLogin;
  showLoginBtn.classList.toggle("active", isLogin);
  showSignupBtn.classList.toggle("active", !isLogin);
  showLoginBtn.classList.toggle("secondary", !isLogin);
  showSignupBtn.classList.toggle("secondary", isLogin);
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

function renderBookings(rows) {
  bookingsList.innerHTML = "";

  if (!rows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td colspan="7">No bookings found for your account email yet.</td>';
    bookingsList.appendChild(tr);
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    const catLabel = `${row.cat_name} (${row.breed || "-"}, ${row.age ?? "-"}y)`;
    const dateLabel = `${row.check_in} to ${row.check_out}`;
    tr.innerHTML = `
      <td>${row.id}</td>
      <td>${catLabel}</td>
      <td>${dateLabel}</td>
      <td>${row.suite_type || "-"}</td>
      <td>${row.add_on || "-"}</td>
      <td>${formatMoney(row.total_price)}</td>
      <td>${row.notes || "-"}</td>
    `;
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

showLoginBtn.addEventListener("click", () => setMode("login"));
showSignupBtn.addEventListener("click", () => setMode("signup"));

refreshBtn.addEventListener("click", loadMyBookings);

logoutBtn.addEventListener("click", () => {
  clearSession();
  showLoggedOutUi();
  setAuthStatus("You are signed out.", false);
});

async function init() {
  setMode("login");
  const valid = await verifySession();
  if (!valid) {
    clearSession();
    showLoggedOutUi();
    setAuthStatus("Sign in or sign up to continue.", false);
    return;
  }

  const name = localStorage.getItem("lb_user_name") || "";
  const email = localStorage.getItem("lb_user_email") || "";
  showAuthenticatedUi(name, email);
  setAuthStatus("Signed in with existing session.", true);
  await loadMyBookings();
}

init();
