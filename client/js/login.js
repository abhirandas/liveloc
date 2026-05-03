const API_BASE = "/api";

// Redirect if already logged in
if (localStorage.getItem("token")) {
  window.location.href = "map.html";
}

// Tab switching
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    document.getElementById("login-form").classList.toggle("hidden", tab !== "login");
    document.getElementById("register-form").classList.toggle("hidden", tab !== "register");

    clearAlerts();
  });
});

function showAlert(elementId, message, type) {
  const el = document.getElementById(elementId);
  el.textContent = message;
  el.className = `alert alert-${type}`;
}

function clearAlerts() {
  ["login-alert", "register-alert"].forEach((id) => {
    const el = document.getElementById(id);
    el.className = "alert hidden";
    el.textContent = "";
  });
}

function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  btn.disabled = loading;
  btn.textContent = loading
    ? btnId === "login-btn"
      ? "Signing in..."
      : "Creating account..."
    : btnId === "login-btn"
    ? "Sign In"
    : "Create Account";
}

// Login
document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearAlerts();

  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;

  setLoading("login-btn", true);

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      showAlert("login-alert", data.error || "Login failed", "error");
      return;
    }

    localStorage.setItem("token", data.token);
    localStorage.setItem("userId", data.userId);
    localStorage.setItem("email", data.email);
    window.location.href = "map.html";
  } catch {
    showAlert("login-alert", "Cannot reach server. Is it running?", "error");
  } finally {
    setLoading("login-btn", false);
  }
});

// Register
document.getElementById("register-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearAlerts();

  const email = document.getElementById("reg-email").value.trim();
  const password = document.getElementById("reg-password").value;

  if (password.length < 6) {
    showAlert("register-alert", "Password must be at least 6 characters", "error");
    return;
  }

  setLoading("register-btn", true);

  try {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      showAlert("register-alert", data.error || "Registration failed", "error");
      return;
    }

    localStorage.setItem("token", data.token);
    localStorage.setItem("userId", data.userId);
    localStorage.setItem("email", data.email);
    window.location.href = "map.html";
  } catch {
    showAlert("register-alert", "Cannot reach server. Is it running?", "error");
  } finally {
    setLoading("register-btn", false);
  }
});
