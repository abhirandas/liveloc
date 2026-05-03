const SERVER_URL = window.location.origin;
const LOCATION_INTERVAL_MS = 3000;
const MARKER_COLORS = [
  "#4f8ef7", "#e05c9a", "#4caf7d", "#f5a623",
  "#a855f7", "#06b6d4", "#f97316", "#84cc16",
];

// Auth guard
const token = localStorage.getItem("token");
const myUserId = localStorage.getItem("userId");
const myEmail = localStorage.getItem("email");

if (!token || !myUserId) {
  window.location.href = "login.html";
}

document.getElementById("user-info").textContent = myEmail;

// ─── Leaflet map setup ───
const map = L.map("map").setView([20.5937, 78.9629], 5);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 19,
}).addTo(map);

// ─── Marker management ───
const markers = new Map(); // userId -> { marker, color }
let colorIndex = 0;

function getColor(userId) {
  if (!markers.has(userId)) return null;
  return markers.get(userId).color;
}

function assignColor() {
  const color = MARKER_COLORS[colorIndex % MARKER_COLORS.length];
  colorIndex++;
  return color;
}

function makeIcon(color, isMe) {
  const size = isMe ? 16 : 12;
  const border = isMe ? "3px solid white" : "2px solid white";
  return L.divIcon({
    className: "",
    html: `<div style="
      width:${size}px;height:${size}px;
      border-radius:50%;
      background:${color};
      border:${border};
      box-shadow:0 0 8px ${color}88;
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function upsertMarker(userId, email, lat, lng) {
  const isMe = userId === myUserId;

  if (markers.has(userId)) {
    const { marker } = markers.get(userId);
    marker.setLatLng([lat, lng]);
  } else {
    const color = isMe ? "#4f8ef7" : assignColor();
    const marker = L.marker([lat, lng], { icon: makeIcon(color, isMe) })
      .bindTooltip(isMe ? `${email} (you)` : email, {
        permanent: false,
        direction: "top",
        offset: [0, -8],
      })
      .addTo(map);

    markers.set(userId, { marker, color });
  }

  updateUserList();
}

function removeMarker(userId) {
  if (markers.has(userId)) {
    const { marker } = markers.get(userId);
    map.removeLayer(marker);
    markers.delete(userId);
    updateUserList();
  }
}

// ─── Sidebar user list ───
const onlineUsers = new Map(); // userId -> email

function updateUserList() {
  const list = document.getElementById("user-list");
  const count = document.getElementById("user-count");
  count.textContent = onlineUsers.size;

  if (onlineUsers.size === 0) {
    list.innerHTML = '<p class="no-users">No users online</p>';
    return;
  }

  list.innerHTML = "";
  onlineUsers.forEach((email, userId) => {
    const isMe = userId === myUserId;
    const color = markers.has(userId) ? markers.get(userId).color : "#8b8fa8";

    const item = document.createElement("div");
    item.className = "user-item";
    item.innerHTML = `
      <div class="user-dot" style="background:${color}"></div>
      <span class="user-email${isMe ? " you" : ""}">${isMe ? email + " (you)" : email}</span>
    `;
    list.appendChild(item);
  });
}

// ─── Socket.IO ───
const socket = io(SERVER_URL, {
  auth: { token },
  reconnectionAttempts: 5,
  reconnectionDelay: 2000,
});

const statusDot = document.getElementById("status-dot");
const locationStatus = document.getElementById("location-status");

socket.on("connect", () => {
  statusDot.classList.add("connected");
  console.log("Socket connected:", socket.id);
});

socket.on("disconnect", (reason) => {
  statusDot.classList.remove("connected");
  console.warn("Socket disconnected:", reason);
});

socket.on("connect_error", (err) => {
  console.error("Socket connection error:", err.message);
  if (err.message === "Invalid or expired token" || err.message === "Authentication required") {
    localStorage.clear();
    window.location.href = "login.html";
  }
});

// Snapshot of currently online users on connect
socket.on("users:snapshot", (snapshot) => {
  Object.entries(snapshot).forEach(([userId, data]) => {
    onlineUsers.set(userId, data.email);
    upsertMarker(userId, data.email, data.lat, data.lng);
  });
});

// Live location update from another user (via Kafka broadcaster)
socket.on("location:update", (data) => {
  const { userId, email, lat, lng } = data;
  onlineUsers.set(userId, email);
  upsertMarker(userId, email, lat, lng);
});

socket.on("user:left", ({ userId }) => {
  onlineUsers.delete(userId);
  removeMarker(userId);
});

socket.on("error", (err) => {
  console.warn("Socket error from server:", err.message);
});

// ─── Geolocation ───
let locationWatcher = null;
let centeredOnUser = false;

function startLocationSharing() {
  if (!navigator.geolocation) {
    locationStatus.textContent = "Geolocation not supported by your browser";
    return;
  }

  locationStatus.textContent = "Requesting location permission…";

  locationWatcher = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      locationStatus.textContent = `Sharing: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;

      // Auto-center map on first fix
      if (!centeredOnUser) {
        map.setView([lat, lng], 14);
        centeredOnUser = true;
      }

      onlineUsers.set(myUserId, myEmail);
      upsertMarker(myUserId, myEmail, lat, lng);

      socket.emit("location:update", { lat, lng });
    },
    (err) => {
      console.error("Geolocation error:", err);
      locationStatus.textContent = `Location error: ${err.message}`;
    },
    {
      enableHighAccuracy: true,
      maximumAge: LOCATION_INTERVAL_MS,
      timeout: 10000,
    }
  );
}

// Heartbeat — keeps TTL alive even if user stops moving
setInterval(() => {
  if (socket.connected) {
    socket.emit("heartbeat");
  }
}, LOCATION_INTERVAL_MS);

// Logout
document.getElementById("logout-btn").addEventListener("click", () => {
  if (locationWatcher !== null) {
    navigator.geolocation.clearWatch(locationWatcher);
  }
  socket.disconnect();
  localStorage.clear();
  window.location.href = "login.html";
});

// Start sharing on load
startLocationSharing();
