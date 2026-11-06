// ui.js - small DOM helpers (avatars, chips, toasts, time formatting)

export const PALETTE = ["#3366CC", "#7B3FB8", "#0B7A75", "#B4442B", "#2E7D32", "#8A5A00"];

export function initials(name) {
  const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0][0] || "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export function colourFor(seed) {
  let h = 0;
  const s = String(seed || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// A profile photo is stored as a small JPEG data URL inside the user's Firestore profile.
export const PHOTO_PREFIX = "data:image/jpeg;base64,";
export const PHOTO_MAX_CHARS = 40000;

export function isPhotoDataUrl(value) {
  return typeof value === "string" && value.startsWith(PHOTO_PREFIX) &&
    value.length > PHOTO_PREFIX.length && value.length <= PHOTO_MAX_CHARS &&
    /^[A-Za-z0-9+/=]+$/.test(value.slice(PHOTO_PREFIX.length));
}

// Centre-crop square: which part of a w x h picture to copy so the result is square.
export function squareCrop(w, h) {
  const s = Math.min(w, h);
  return { sx: Math.round((w - s) / 2), sy: Math.round((h - s) / 2), s };
}

// Which square of a w x h picture to copy. zoom >= 1 (1 = largest square, 4 = a quarter of it),
// (cx, cy) = wanted centre in picture pixels. The square is always kept inside the picture.
export function cropRect(w, h, zoom = 1, cx = w / 2, cy = h / 2) {
  const s = Math.min(w, h) / Math.max(1, Number(zoom) || 1);
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  return { sx: clamp(cx - s / 2, 0, w - s), sy: clamp(cy - s / 2, 0, h - s), s };
}

export function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type || "")) { reject(new Error("not-an-image")); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad-image")); };
    img.src = url;
  });
}

// Copy the chosen square into a small JPEG data URL that fits the size limit.
export function cropToDataUrl(img, rect, size = 160, quality = 0.72) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(img, rect.sx, rect.sy, rect.s, rect.s, 0, 0, size, size);
  let q = quality, out = canvas.toDataURL("image/jpeg", q);
  while (out.length > PHOTO_MAX_CHARS && q > 0.3) { q -= 0.1; out = canvas.toDataURL("image/jpeg", q); }
  if (!isPhotoDataUrl(out)) throw new Error("too-large");
  return out;
}

export function createAvatar(name, seed, size = 44, photo = "") {
  const el = document.createElement("div");
  el.className = "avatar";
  el.setAttribute("aria-hidden", "true");
  el.style.width = el.style.height = size + "px";
  el.style.fontSize = Math.round(size * 0.38) + "px";
  el.style.background = colourFor(seed || name);
  if (isPhotoDataUrl(photo)) {
    el.classList.add("avatar-photo");
    el.style.backgroundImage = 'url("' + photo + '")';
  } else {
    el.textContent = initials(name);
  }
  return el;
}

export function createChip(text, kind = "") {
  const el = document.createElement("span");
  el.className = "chip" + (kind ? " chip-" + kind : "");
  el.textContent = text;
  return el;
}

export function formatTime(date) {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d)) return "";
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return time;
  return d.toLocaleDateString([], { day: "numeric", month: "short" }) + " " + time;
}

export function toast(text, kind = "info") {
  const host = document.getElementById("toasts");
  if (!host) return;
  // show an identical message only once, and keep at most 3 on screen
  for (const t of host.children) if (t.textContent === text && !t.classList.contains("out")) return;
  while (host.children.length >= 3) host.firstElementChild.remove();
  const el = document.createElement("div");
  el.className = "toast toast-" + kind;
  el.textContent = text;
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 300);
  }, 3800);
}

export function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try { localStorage.setItem("campusmate-theme", theme); } catch (e) { /* ignore */ }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#0E1424" : "#3366CC");
}

export function initThemeToggle() {
  const current = () => document.documentElement.getAttribute("data-theme") || "light";
  setTheme(current());
  document.querySelectorAll(".theme-toggle").forEach((b) => {
    b.addEventListener("click", () => setTheme(current() === "dark" ? "light" : "dark"));
  });
}

// base64url helpers for WebAuthn credential ids
export function toB64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64Url(text) {
  const b64 = String(text).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
