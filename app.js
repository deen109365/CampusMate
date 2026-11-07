// CampusMate - app.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, updateProfile, sendPasswordResetEmail, sendEmailVerification
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, getFirestore, doc, collection,
  setDoc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, arrayRemove, query, where, orderBy, limit, limitToLast,
  onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { findCompatible, pairId, isValidModule, normaliseModule, matchLabel } from "./matching.js";
import {
  validateSession, isActive, isUpcoming, needsRating, pendingForMe, sortByStart,
  describeWhen, reminderFor, averageRating, isUnread, isSeen, todayString, tsMillis,
  buildIcs, googleCalendarUrl, minutesUntil
} from "./sessions.js";
import { createAvatar, createChip, formatTime, toast, initThemeToggle, toB64Url, fromB64Url, loadImageFile, cropRect, cropToDataUrl, isPhotoDataUrl } from "./ui.js";
import { validateGroupName, validateGroupMembers, buildGroup, memberLabel, canLeaveByDelete } from "./groups.js";
import { buildOverpassQuery, parsePlaces, filterByKind, formatDistance, KINDS } from "./places.js";

const firebaseConfig = {
  apiKey: "AIzaSyDAX6Fr8co_fNhC7A6BrhucWrV_194UnMc",
  authDomain: "campusmate-d767b.firebaseapp.com",
  projectId: "campusmate-d767b",
  storageBucket: "campusmate-d767b.firebasestorage.app",
  messagingSenderId: "359271378636",
  appId: "1:359271378636:web:468fb1acec6d5a09095c69"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
let db;
try {
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
} catch (e) {
  db = getFirestore(app);
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TIMES = ["Morning", "Afternoon", "Evening"];
const FORMATS = ["In person", "Online", "Either"];
const GOALS = ["Coursework", "Exam revision", "Catch-up"];
const QUICK_PLACES = ["Main Library", "Campus cafe", "Study room", "Online call"];

const $ = (id) => document.getElementById(id);
initThemeToggle();

// ---- State ----
let me = null;              // firebase user
let profile = null;         // my profile doc data
let requests = [];          // all request docs involving me
let blockedUids = new Set();
let myRatedIds = new Set(); // session ids I have rated
let unsubs = [];            // top-level listeners
const pairSubs = new Map(); // pairId -> { unsubs, sessions, latest, read }
let unsubMessages = null;
let activePair = null;
let activePartner = null;
let authMode = "login";
let lastMatches = null;
let deferredInstall = null;
let startedAt = Date.now();
let requestsReady = false;
let pendingPhoto = "";                 // profile photo being edited (JPEG data URL or "")
const photoCache = new Map();          // uid -> photo data URL ("" = none), for partners / requests
let groups = [];                       // groups I belong to
let activeGroup = null;                // group id open in the group chat
let unsubGroupMsgs = null;
const prevRequestStatus = new Map();   // pid -> status, to detect changes
const announcedMessage = new Map();    // pid -> last announced message time
const reminded = new Set();            // session ids already reminded

// ---- Helpers ----
function makeButton(text, className, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn " + className;
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function emptyState(title, text) {
  const d = el("div", "empty");
  d.append(el("strong", "", title), document.createTextNode(text));
  return d;
}

function friendlyError(err) {
  const code = (err && err.code) || "";
  const map = {
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/wrong-password": "Email or password is incorrect.",
    "auth/user-not-found": "No account found for that email.",
    "auth/email-already-in-use": "That email already has an account. Try logging in.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/network-request-failed": "Network problem. Check your connection and try again.",
    "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
    "permission-denied": "You do not have permission to do that.",
    "unavailable": "You appear to be offline. Try again when connected."
  };
  return map[code] || "Something went wrong. Please try again.";
}
const errToast = (err) => toast(friendlyError(err), "error");

function timestampToDate(ts) {
  const ms = tsMillis(ts);
  return ms ? new Date(ms) : null;
}

// ---- Notifications ----
const NOTIFY_KEY = "campusmate-notify";
function notifySupported() { return "Notification" in window; }
function notifyEnabled() {
  try {
    return notifySupported() && Notification.permission === "granted" && localStorage.getItem(NOTIFY_KEY) === "1";
  } catch (e) { return false; }
}

async function systemNotify(title, body, tag) {
  try {
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg && reg.showNotification) {
      await reg.showNotification(title, { body, tag, icon: "icon-192.png", badge: "icon-192.png" });
    } else {
      new Notification(title, { body, tag, icon: "icon-192.png" });
    }
  } catch (e) { /* notifications are optional */ }
}

// Visible app: show an in-app toast. Hidden app: show a system notification if the user opted in.
function announce(title, body, tag) {
  if (!document.hidden) { toast(title + ": " + body); return; }
  if (notifyEnabled()) systemNotify(title, body, tag);
}

function updateNotifyUi() {
  const toggle = $("notif-toggle");
  const text = $("notif-text");
  if (!notifySupported()) {
    toggle.checked = false; toggle.disabled = true;
    text.textContent = "Not supported in this browser. On iPhone, install the app to the home screen first.";
    return;
  }
  if (Notification.permission === "denied") {
    toggle.checked = false; toggle.disabled = true;
    text.textContent = "Blocked in your browser settings. Allow notifications for this site to turn them on.";
    return;
  }
  toggle.disabled = false;
  toggle.checked = notifyEnabled();
  text.textContent = "Alerts for new messages, requests and sessions while CampusMate is open or in the background.";
}

$("notif-toggle").addEventListener("change", async (e) => {
  if (!notifySupported()) return;
  if (e.target.checked) {
    let perm = Notification.permission;
    if (perm === "default") perm = await Notification.requestPermission();
    if (perm === "granted") {
      try { localStorage.setItem(NOTIFY_KEY, "1"); } catch (err) { /* ignore */ }
      toast("Notifications turned on", "success");
      systemNotify("CampusMate", "Notifications are on. You will be alerted about messages and sessions.", "welcome");
    } else {
      try { localStorage.setItem(NOTIFY_KEY, "0"); } catch (err) { /* ignore */ }
    }
  } else {
    try { localStorage.setItem(NOTIFY_KEY, "0"); } catch (err) { /* ignore */ }
    toast("Notifications turned off");
  }
  updateNotifyUi();
});

function checkSessionReminders() {
  if (!me) return;
  const now = new Date();
  for (const s of allSessions()) {
    const mins = minutesUntil(s, now);
    if (mins === null || mins < 0 || mins > 60 || reminded.has(s.id)) continue;
    reminded.add(s.id);
    announce("Study session soon", "With " + pairName(s.pid).name + " in " + Math.max(mins, 1) + " min at " + s.place, "remind-" + s.id);
  }
}
setInterval(checkSessionReminders, 30000);

// ---- Biometric lock (WebAuthn platform authenticator) ----
const RELOCK_MS = 2 * 60 * 1000;
let hiddenAt = 0;
const bioKey = () => "campusmate-bio-" + (me ? me.uid : "");

function bioSupported() {
  return !!(window.PublicKeyCredential && navigator.credentials && window.isSecureContext);
}
async function bioAvailable() {
  if (!bioSupported()) return false;
  try { return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch (e) { return false; }
}
function bioEnabled() {
  try { return !!localStorage.getItem(bioKey()); } catch (e) { return false; }
}
function randomChallenge() {
  return crypto.getRandomValues(new Uint8Array(32));
}

async function enableBiometric() {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: randomChallenge(),
      rp: { name: "CampusMate" },
      user: { id: new TextEncoder().encode(me.uid), name: me.email || me.uid, displayName: currentName() },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
      timeout: 60000
    }
  });
  localStorage.setItem(bioKey(), toB64Url(cred.rawId));
}

async function verifyBiometric() {
  const id = fromB64Url(localStorage.getItem(bioKey()));
  await navigator.credentials.get({
    publicKey: {
      challenge: randomChallenge(),
      allowCredentials: [{ type: "public-key", id, transports: ["internal"] }],
      userVerification: "required",
      timeout: 60000
    }
  });
}

function isLocked() { return !$("lock-section").hidden; }

function lockApp(autoPrompt) {
  document.querySelectorAll("dialog[open]").forEach((d) => d.close());
  $("lock-section").hidden = false;
  $("app-section").inert = true;
  $("lock-message").textContent = "";
  if (autoPrompt) tryUnlock();
  else $("unlock-btn").focus();
}

function unlockApp() {
  $("lock-section").hidden = true;
  $("app-section").inert = false;
}

let unlocking = false;
async function tryUnlock() {
  if (unlocking) return;
  unlocking = true;
  $("lock-message").textContent = "";
  try {
    await verifyBiometric();
    unlockApp();
  } catch (e) {
    $("lock-message").textContent = "Could not verify. Try again, or use your password.";
  } finally {
    unlocking = false;
  }
}
$("unlock-btn").addEventListener("click", tryUnlock);
$("lock-signout").addEventListener("click", async () => {
  unlockApp();
  await signOut(auth);
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (me && bioEnabled() && hiddenAt && Date.now() - hiddenAt > RELOCK_MS && !isLocked()) lockApp(true);
});

async function updateBioUi() {
  const toggle = $("bio-toggle");
  const text = $("bio-text");
  const ok = await bioAvailable();
  if (!ok) {
    toggle.checked = false; toggle.disabled = true;
    text.textContent = "Not available on this device or browser (needs fingerprint, face or PIN set up, and HTTPS).";
    return;
  }
  toggle.disabled = false;
  toggle.checked = bioEnabled();
  text.textContent = "Ask for fingerprint, face or device PIN when you open CampusMate or return after 2 minutes.";
}

$("bio-toggle").addEventListener("change", async (e) => {
  if (e.target.checked) {
    try {
      await enableBiometric();
      toast("Biometric lock turned on", "success");
    } catch (err) {
      e.target.checked = false;
      toast("Could not set up the biometric lock.", "error");
    }
  } else {
    try { localStorage.removeItem(bioKey()); } catch (err) { /* ignore */ }
    toast("Biometric lock turned off");
  }
  updateBioUi();
});

// ---- Offline banner + global errors ----
function syncOnline() { $("offline-banner").hidden = navigator.onLine; }
window.addEventListener("online", syncOnline);
window.addEventListener("offline", syncOnline);
syncOnline();
window.addEventListener("unhandledrejection", (e) => {
  console.error(e.reason);
  toast("Something went wrong. Please try again.", "error");
});

// ---- Navigation ----
function showView(name) {
  for (const v of ["home", "messages", "profile"]) {
    $("view-" + v).hidden = v !== name;
  }
  document.querySelectorAll("#bottom-nav button").forEach((b) => {
    if (b.dataset.view === name) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  window.scrollTo({ top: 0 });
}
document.querySelectorAll("#bottom-nav button").forEach((b) => {
  b.addEventListener("click", () => {
    if (b.dataset.view === "messages" && activePair) closeChat();
    if (b.dataset.view === "messages" && activeGroup) closeGroup();
    showView(b.dataset.view);
  });
});

// ---- Dialogs ----
function openDialog(cfg) {
  const { title, text = "", okLabel = "OK", danger = false, textarea = null, checkbox = null } = cfg;
  return new Promise((resolve) => {
    const dlg = $("dlg");
    if (typeof dlg.showModal !== "function") {
      resolve(window.confirm(title + "\n" + text) ? { text: "", checked: !!(checkbox && checkbox.checked) } : null);
      return;
    }
    $("dlg-title").textContent = title;
    $("dlg-text").textContent = text;
    $("dlg-error").textContent = "";
    const taWrap = $("dlg-textarea-wrap");
    taWrap.hidden = !textarea;
    $("dlg-textarea").value = "";
    if (textarea) $("dlg-textarea-label").textContent = textarea.label;
    const cbWrap = $("dlg-checkbox-wrap");
    cbWrap.hidden = !checkbox;
    if (checkbox) {
      $("dlg-checkbox").checked = !!checkbox.checked;
      $("dlg-checkbox-label").textContent = checkbox.label;
    }
    const ok = $("dlg-ok");
    ok.textContent = okLabel;
    ok.className = "btn " + (danger ? "btn-danger-solid" : "btn-primary");
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      dlg.close();
      resolve(val);
    };
    ok.onclick = () => {
      const val = $("dlg-textarea").value.trim();
      if (textarea && textarea.required && val.length < 3) {
        $("dlg-error").textContent = "Please add a few words so we can review it.";
        return;
      }
      finish({ text: val, checked: $("dlg-checkbox").checked });
    };
    $("dlg-cancel").onclick = () => finish(null);
    dlg.oncancel = (e) => { e.preventDefault(); finish(null); };
    dlg.showModal();
  });
}

function openSessionDialog(partnerName, place = "") {
  return new Promise((resolve) => {
    const dlg = $("session-dlg");
    if (typeof dlg.showModal !== "function") { toast("Your browser does not support this dialog.", "error"); resolve(null); return; }
    $("session-with").textContent = "With " + partnerName;
    $("session-error").textContent = "";
    const dateInput = $("s-date");
    dateInput.min = todayString();
    dateInput.value = "";
    $("s-time").value = "";
    $("s-place").value = place;
    const quick = $("s-quick");
    quick.replaceChildren();
    for (const place of QUICK_PLACES) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = place;
      b.addEventListener("click", () => { $("s-place").value = place; });
      quick.appendChild(b);
    }
    let done = false;
    const finish = (val) => { if (done) return; done = true; dlg.close(); resolve(val); };
    $("session-ok").onclick = () => {
      const values = { date: dateInput.value, time: $("s-time").value, place: $("s-place").value.trim() };
      const problem = validateSession(values);
      if (problem) { $("session-error").textContent = problem; return; }
      finish(values);
    };
    $("session-cancel").onclick = () => finish(null);
    dlg.oncancel = (e) => { e.preventDefault(); finish(null); };
    dlg.showModal();
  });
}

// ---- Auth UI ----
function setAuthMode(mode) {
  authMode = mode;
  $("mode-login").setAttribute("aria-pressed", String(mode === "login"));
  $("mode-signup").setAttribute("aria-pressed", String(mode === "signup"));
  $("name-field").hidden = mode !== "signup";
  $("auth-submit").textContent = mode === "login" ? "Log in" : "Create account";
  $("auth-password").autocomplete = mode === "login" ? "current-password" : "new-password";
  $("auth-message").textContent = "";
  $("auth-message").className = "form-message";
  $("forgot-btn").hidden = mode !== "login";
}
$("mode-login").addEventListener("click", () => setAuthMode("login"));
$("mode-signup").addEventListener("click", () => setAuthMode("signup"));

$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("auth-email").value.trim();
  const password = $("auth-password").value;
  const name = $("auth-name").value.trim();
  const msg = $("auth-message");
  msg.className = "form-message";
  msg.textContent = "";
  if (!email || !password) { msg.textContent = "Please enter your email and password."; return; }
  if (authMode === "signup" && !name) { msg.textContent = "Please enter your name."; return; }
  const btn = $("auth-submit");
  btn.disabled = true;
  try {
    if (authMode === "signup") {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });
      sendEmailVerification(cred.user).catch(() => { /* they can resend from Home */ });
      renderAppbar(name);
      renderGreeting(name);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (err) {
    msg.textContent = friendlyError(err);
  } finally {
    btn.disabled = false;
  }
});

$("forgot-btn").addEventListener("click", async () => {
  const email = $("auth-email").value.trim();
  const msg = $("auth-message");
  msg.className = "form-message";
  if (!email) { msg.textContent = "Enter your email above first, then tap Forgot password."; return; }
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (err) {
    const show = ["auth/invalid-email", "auth/network-request-failed", "auth/too-many-requests"];
    if (show.includes(err.code)) { msg.textContent = friendlyError(err); return; }
    // for other errors (e.g. no such account) give the same answer so accounts cannot be guessed
  }
  msg.className = "form-message ok";
  msg.textContent = "If an account exists for that email, a reset link is on its way. Check your spam folder too.";
});

$("logout-btn").addEventListener("click", async () => {
  await signOut(auth);
  toast("You have been logged out.");
});

// ---- Email verification (soft: never blocks the app) ----
function updateVerifyUi() {
  const banner = $("verify-banner");
  if (!me || me.emailVerified) { banner.hidden = true; return; }
  $("verify-text").textContent = "We sent a link to " + (me.email || "your email") + ". Click it, then tap the button below. Check your spam folder too.";
  banner.hidden = false;
}
$("verify-resend").addEventListener("click", async () => {
  if (!me) return;
  try {
    await sendEmailVerification(me);
    toast("Verification email sent. Check your inbox and spam.", "success");
  } catch (err) {
    errToast(err);
  }
});
$("verify-check").addEventListener("click", async () => {
  if (!me) return;
  try {
    await me.reload();
  } catch (err) {
    errToast(err);
    return;
  }
  updateVerifyUi();
  if (me.emailVerified) toast("Email verified. Thank you!", "success");
  else toast("Not verified yet. Open the link in the email first.");
});

// ---- Header / greeting ----
function currentName() {
  return (profile && profile.name) || (me && me.displayName) || (me && me.email ? me.email.split("@")[0] : "Student");
}
function renderAppbar(name) {
  $("appbar-avatar").replaceChildren(createAvatar(name, me ? me.uid : name, 38, profile && profile.photo));
}
function renderGreeting(name) {
  $("home-title").textContent = "Hello, " + String(name).split(" ")[0];
}

// ---- Profile ----
function buildToggles(hostId, values, type, groupName) {
  const host = $(hostId);
  host.replaceChildren();
  for (const v of values) {
    const label = el("label", "toggle");
    const input = document.createElement("input");
    input.type = type;
    input.name = groupName;
    input.value = v;
    label.append(input, el("span", "", v));
    host.appendChild(label);
  }
}
buildToggles("p-days", DAYS, "checkbox", "days");
buildToggles("p-times", TIMES, "checkbox", "times");
buildToggles("p-format", FORMATS, "radio", "format");
buildToggles("p-goal", GOALS, "radio", "goal");

function checkedValues(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);
}

function fillProfileForm(p) {
  $("p-name").value = (p && p.name) || (me && me.displayName) || "";
  $("p-module").value = (p && p.module) || "";
  document.querySelectorAll('input[name="days"]').forEach((i) => { i.checked = !!(p && (p.days || []).includes(i.value)); });
  document.querySelectorAll('input[name="times"]').forEach((i) => { i.checked = !!(p && (p.times || []).includes(i.value)); });
  document.querySelectorAll('input[name="format"]').forEach((i) => { i.checked = !!(p && p.format === i.value); });
  document.querySelectorAll('input[name="goal"]').forEach((i) => { i.checked = !!(p && p.goal === i.value); });
  $("p-visible").checked = p ? p.visible !== false : true;
  pendingPhoto = p && isPhotoDataUrl(p.photo) ? p.photo : "";
  renderPhotoPreview();
}

function renderPhotoPreview() {
  const name = $("p-name").value.trim() || currentName();
  $("p-photo-preview").replaceChildren(createAvatar(name, me ? me.uid : name, 72, pendingPhoto));
  $("p-photo-remove").hidden = !pendingPhoto;
  $("p-photo-pick").textContent = pendingPhoto ? "Change photo" : "Choose photo";
}
$("p-name").addEventListener("input", () => { if (!pendingPhoto) renderPhotoPreview(); });
$("p-photo-pick").addEventListener("click", () => $("p-photo-file").click());
$("p-photo-remove").addEventListener("click", () => { pendingPhoto = ""; renderPhotoPreview(); });
$("p-photo-file").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    openCropper(await loadImageFile(file));
  } catch (err) {
    toast("That file could not be used as a photo. Try a JPG or PNG picture.", "error");
  }
});

// ---- Photo cropper: drag to position, slider to zoom ----
const CROP_PX = 280;
let cropState = null;   // { img, url, zoom, cx, cy }

function drawCrop() {
  const st = cropState;
  if (!st) return;
  const r = cropRect(st.img.naturalWidth, st.img.naturalHeight, st.zoom, st.cx, st.cy);
  st.cx = r.sx + r.s / 2;
  st.cy = r.sy + r.s / 2;
  const ctx = $("crop-canvas").getContext("2d");
  ctx.clearRect(0, 0, CROP_PX, CROP_PX);
  ctx.drawImage(st.img, r.sx, r.sy, r.s, r.s, 0, 0, CROP_PX, CROP_PX);
  ctx.save();
  ctx.fillStyle = "rgba(10,16,32,.55)";
  ctx.beginPath();
  ctx.rect(0, 0, CROP_PX, CROP_PX);
  ctx.arc(CROP_PX / 2, CROP_PX / 2, CROP_PX / 2 - 4, 0, Math.PI * 2, true);
  ctx.fill("evenodd");
  ctx.restore();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(CROP_PX / 2, CROP_PX / 2, CROP_PX / 2 - 4, 0, Math.PI * 2);
  ctx.stroke();
}

function moveCrop(dxCanvas, dyCanvas) {
  const st = cropState;
  if (!st) return;
  const side = Math.min(st.img.naturalWidth, st.img.naturalHeight) / st.zoom;
  const scale = side / $("crop-canvas").getBoundingClientRect().width;
  st.cx -= dxCanvas * scale;
  st.cy -= dyCanvas * scale;
  drawCrop();
}

function openCropper(loaded) {
  const dlg = $("crop-dlg");
  if (typeof dlg.showModal !== "function") { toast("Your browser does not support photo cropping.", "error"); URL.revokeObjectURL(loaded.url); return; }
  cropState = { img: loaded.img, url: loaded.url, zoom: 1, cx: loaded.img.naturalWidth / 2, cy: loaded.img.naturalHeight / 2 };
  $("crop-zoom").value = "1";
  dlg.showModal();
  drawCrop();
}

(function initCropper() {
  const canvas = $("crop-canvas");
  let last = null;
  canvas.addEventListener("pointerdown", (e) => { last = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => {
    if (!last) return;
    moveCrop(e.clientX - last.x, e.clientY - last.y);
    last = { x: e.clientX, y: e.clientY };
  });
  const stop = () => { last = null; };
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);
  canvas.addEventListener("keydown", (e) => {
    const step = 14, d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (d) { e.preventDefault(); moveCrop(d[0], d[1]); }
  });
  $("crop-zoom").addEventListener("input", (e) => { if (cropState) { cropState.zoom = Number(e.target.value); drawCrop(); } });
  $("crop-cancel").addEventListener("click", () => $("crop-dlg").close());
  $("crop-dlg").addEventListener("close", () => {
    if (cropState) { URL.revokeObjectURL(cropState.url); cropState = null; }
  });
  $("crop-ok").addEventListener("click", () => {
    if (!cropState) return;
    try {
      const st = cropState;
      pendingPhoto = cropToDataUrl(st.img, cropRect(st.img.naturalWidth, st.img.naturalHeight, st.zoom, st.cx, st.cy));
      $("crop-dlg").close();
      renderPhotoPreview();
      toast("Photo ready. Tap Save profile to keep it.");
    } catch (err) {
      toast("That photo could not be used. Try another picture.", "error");
    }
  });
})();

function readProfileForm() {
  return {
    name: $("p-name").value.trim(),
    module: normaliseModule($("p-module").value),
    days: checkedValues("days"),
    times: checkedValues("times"),
    format: checkedValues("format")[0] || "",
    goal: checkedValues("goal")[0] || "",
    visible: $("p-visible").checked,
    photo: pendingPhoto
  };
}

function cacheKey() { return "campusmate-profile-" + (me ? me.uid : ""); }

async function loadProfile() {
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(cacheKey())); } catch (e) { /* ignore */ }
  try {
    const snap = await getDoc(doc(db, "users", me.uid));
    if (snap.exists()) {
      profile = snap.data();
      try { localStorage.setItem(cacheKey(), JSON.stringify(profile)); } catch (e) { /* ignore */ }
      return;
    }
    profile = null;
  } catch (err) {
    profile = cached;
  }
}

$("profile-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("profile-message");
  msg.className = "form-message";
  msg.textContent = "";
  const p = readProfileForm();
  if (!p.name) { msg.textContent = "Please enter your display name."; return; }
  if (!isValidModule(p.module)) { msg.textContent = "Module code should be letters then numbers, e.g. CS32005."; return; }
  if (!p.days.length) { msg.textContent = "Pick at least one day."; return; }
  if (!p.times.length) { msg.textContent = "Pick at least one time of day."; return; }
  if (!p.format) { msg.textContent = "Choose a study format."; return; }
  if (!p.goal) { msg.textContent = "Choose a study goal."; return; }
  const btn = $("profile-save");
  btn.disabled = true;
  try {
    const existing = profile && profile.createdAt;
    await setDoc(doc(db, "users", me.uid), { ...p, updatedAt: serverTimestamp(), createdAt: existing || serverTimestamp() });
    profile = { ...p, createdAt: existing || null };
    try { localStorage.setItem(cacheKey(), JSON.stringify(profile)); } catch (err) { /* ignore */ }
    renderSummary();
    renderGreeting(profile.name);
    renderAppbar(profile.name);
    lastMatches = null;
    $("matches").replaceChildren();
    toast("Profile saved", "success");
    showView("home");
    findMatches();
  } catch (err) {
    msg.textContent = friendlyError(err);
  } finally {
    btn.disabled = false;
  }
});

function renderSummary() {
  const host = $("profile-summary");
  host.replaceChildren();
  if (!profile) {
    host.append(
      el("h3", "", "Set up your profile"),
      el("p", "", "Add your module and when you like to study so we can find your partners.")
    );
    host.appendChild(makeButton("Complete profile", "btn-primary btn-small", () => showView("profile")));
    return;
  }
  host.append(el("h3", "", profile.module), el("p", "", profile.format + " study" + (profile.visible === false ? " - hidden from others" : "")));
  const chips = el("div", "chips");
  profile.days.forEach((d) => chips.appendChild(createChip(d, "brand")));
  profile.times.forEach((t) => chips.appendChild(createChip(t)));
  if (profile.goal) chips.appendChild(createChip(profile.goal, "ok"));
  host.appendChild(chips);
  host.appendChild(makeButton("Edit profile", "btn-ghost btn-small", () => showView("profile")));
}

// ---- Install prompt ----
function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}
function updateInstallCard() {
  const card = $("install-card");
  const btn = $("install-btn");
  if (isStandalone()) { card.hidden = true; return; }
  if (deferredInstall) {
    card.hidden = false; btn.hidden = false;
    $("install-text").textContent = "Add it to your home screen for a full-screen app experience.";
  } else if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
    card.hidden = false; btn.hidden = true;
    $("install-text").textContent = "On iPhone or iPad: tap the Share button, then Add to Home Screen.";
  } else {
    card.hidden = true;
  }
}
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstall = e; updateInstallCard(); });
window.addEventListener("appinstalled", () => { deferredInstall = null; updateInstallCard(); toast("CampusMate installed", "success"); });
$("install-btn").addEventListener("click", async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  try { await deferredInstall.userChoice; } catch (e) { /* ignore */ }
  deferredInstall = null;
  updateInstallCard();
});

// ---- Partners, blocks ----
function otherUid(r) { return (r.users || []).find((u) => u !== me.uid); }
function partnerOf(r) {
  return r.fromUid === me.uid ? { uid: r.toUid, name: r.toName } : { uid: r.fromUid, name: r.fromName };
}
function partnerPairs() {
  return requests.filter((r) => r.status === "accepted" && !blockedUids.has(otherUid(r)));
}

function subscribeBlocks() {
  let out = [], inc = [];
  const apply = () => {
    blockedUids = new Set([...out.map((b) => b.blocked), ...inc.map((b) => b.blocker)]);
    reconcile();
  };
  unsubs.push(onSnapshot(query(collection(db, "blocks"), where("blocker", "==", me.uid)),
    (snap) => { out = []; snap.forEach((d) => out.push(d.data())); apply(); }, errToast));
  unsubs.push(onSnapshot(query(collection(db, "blocks"), where("blocked", "==", me.uid)),
    (snap) => { inc = []; snap.forEach((d) => inc.push(d.data())); apply(); }, errToast));
}

function subscribeRatings() {
  unsubs.push(onSnapshot(query(collection(db, "ratings"), where("rater", "==", me.uid)),
    (snap) => {
      myRatedIds = new Set();
      snap.forEach((d) => myRatedIds.add(d.data().sessionId));
      renderSessionsEverywhere();
    }, errToast));
}

function subscribeRequests() {
  unsubs.push(onSnapshot(query(collection(db, "requests"), where("users", "array-contains", me.uid)),
    (snap) => {
      requests = [];
      snap.forEach((d) => requests.push({ id: d.id, ...d.data() }));
      detectRequestChanges();
      reconcile();
    }, errToast));
}

function detectRequestChanges() {
  for (const r of requests) {
    const before = prevRequestStatus.get(r.id);
    if (requestsReady && !blockedUids.has(otherUid(r))) {
      if (before === undefined && r.toUid === me.uid && r.status === "pending") {
        announce("New study request", r.fromName + " wants to study with you", "req-" + r.id);
      } else if (before === "pending" && r.status === "accepted" && r.fromUid === me.uid) {
        announce("Request accepted", r.toName + " accepted your request", "acc-" + r.id);
      }
    }
    prevRequestStatus.set(r.id, r.status);
  }
  requestsReady = true;
}

function syncPairSubs() {
  const partners = partnerPairs();
  const want = new Set(partners.map((r) => r.id));
  for (const [pid, sub] of pairSubs) {
    if (!want.has(pid)) { sub.unsubs.forEach((u) => u()); pairSubs.delete(pid); }
  }
  for (const r of partners) {
    if (pairSubs.has(r.id)) continue;
    const sub = { unsubs: [], sessions: [], latest: null, read: null, partnerRead: null };
    pairSubs.set(r.id, sub);
    sub.unsubs.push(onSnapshot(collection(db, "requests", r.id, "sessions"), (snap) => {
      const before = new Map(sub.sessions.map((x) => [x.id, x.status]));
      sub.sessions = [];
      snap.forEach((d) => sub.sessions.push({ id: d.id, pid: r.id, ...d.data() }));
      if (sub.sessionsReady) {
        const who = partnerOf(r).name;
        for (const s of sub.sessions) {
          const was = before.get(s.id);
          if (was === undefined && s.proposedBy !== me.uid && s.status === "proposed") {
            announce("New session proposal", who + " suggests " + describeWhen(s) + " at " + s.place, "ses-" + s.id);
          } else if (was === "proposed" && s.proposedBy === me.uid && (s.status === "accepted" || s.status === "declined")) {
            announce(s.status === "accepted" ? "Session confirmed" : "Session declined", who + " " + s.status + " " + describeWhen(s), "res-" + s.id);
          }
        }
      }
      sub.sessionsReady = true;
      renderSessionsEverywhere();
      checkSessionReminders();
    }, errToast));
    sub.unsubs.push(onSnapshot(query(collection(db, "requests", r.id, "messages"), orderBy("createdAt", "desc"), limit(1)), (snap) => {
      sub.latest = null;
      snap.forEach((d) => { sub.latest = d.data(); });
      renderUnread();
    }, errToast));
    sub.unsubs.push(onSnapshot(doc(db, "requests", r.id, "reads", me.uid), (snap) => {
      sub.read = snap.exists() ? snap.data() : null;
      renderUnread();
    }, errToast));
    // when did my partner last read this chat? (used for the "Seen" label)
    sub.unsubs.push(onSnapshot(doc(db, "requests", r.id, "reads", partnerOf(r).uid), (snap) => {
      sub.partnerRead = snap.exists() ? snap.data() : null;
      if (r.id === activePair) renderChat(chatMsgs);
    }, () => { /* the Seen label is optional */ }));
  }
}

// photos of people I have a request with are loaded once, then cached for the session
const photoLoading = new Set();
function photoFor(uid) { return photoCache.get(uid) || ""; }
async function loadPhotos() {
  const want = requests.map(otherUid).filter((u) => u && !photoCache.has(u) && !photoLoading.has(u));
  if (!want.length) return;
  want.forEach((u) => photoLoading.add(u));
  let changed = false;
  await Promise.all(want.map(async (u) => {
    try {
      const snap = await getDoc(doc(db, "users", u));
      const photo = snap.exists() && isPhotoDataUrl(snap.data().photo) ? snap.data().photo : "";
      photoCache.set(u, photo);
      if (photo) changed = true;
    } catch (e) { /* try again next time */ }
    photoLoading.delete(u);
  }));
  if (changed && me) {
    renderRequests();
    renderPartners();
    if (activePartner) $("chat-avatar").replaceChildren(createAvatar(activePartner.name, activePartner.uid, 40, photoFor(activePartner.uid)));
  }
}

function reconcile() {
  syncPairSubs();
  loadPhotos();
  renderRequests();
  renderPartners();
  renderMatches();
  renderSessionsEverywhere();
  renderUnread();
  if (activePair && !partnerPairs().some((r) => r.id === activePair)) {
    closeChat();
    if (!endingByMe) toast("This chat is no longer available.");
  }
}

// ---- Matches ----
function relatedUids() {
  return new Set(requests.map(otherUid));
}

async function findMatches() {
  const host = $("matches");
  if (!profile) { host.replaceChildren(emptyState("Profile needed", "Complete your profile to see matches.")); return; }
  const btn = $("find-btn");
  btn.disabled = true;
  host.replaceChildren(el("div", "skeleton"), el("div", "skeleton"));
  try {
    const snap = await getDocs(query(collection(db, "users"), where("module", "==", profile.module)));
    const others = [];
    snap.forEach((d) => others.push({ uid: d.id, ...d.data() }));
    lastMatches = findCompatible({ uid: me.uid, ...profile }, others);
    await Promise.all(lastMatches.map(async (m) => {
      try {
        const rs = await getDocs(query(collection(db, "ratings"), where("ratee", "==", m.user.uid)));
        const list = [];
        rs.forEach((d) => list.push(d.data()));
        m.rating = averageRating(list);
      } catch (e) {
        m.rating = { avg: 0, count: 0 };
      }
    }));
    renderMatches();
  } catch (err) {
    host.replaceChildren(emptyState("Could not load matches", friendlyError(err)));
  } finally {
    btn.disabled = false;
  }
}

function renderMatches() {
  const host = $("matches");
  if (lastMatches === null) return;
  host.replaceChildren();
  const taken = relatedUids();
  const list = lastMatches.filter((m) => !taken.has(m.user.uid) && !blockedUids.has(m.user.uid));
  if (!list.length) {
    host.appendChild(emptyState("No new matches yet", "Try adding more days or times, or check back soon as more students join."));
    return;
  }
  for (const m of list) {
    const card = el("article", "card person");
    card.appendChild(createAvatar(m.user.name, m.user.uid, 52, m.user.photo));
    const body = el("div", "person-body");
    body.append(el("div", "person-name", m.user.name), el("div", "muted", m.user.module + " - " + m.user.format));
    const chips = el("div", "chips");
    chips.appendChild(createChip(matchLabel(m.score), "ok"));
    if (m.sameGoal) chips.appendChild(createChip("Same goal: " + m.user.goal, "ok"));
    if (m.rating && m.rating.count) chips.appendChild(createChip("★ " + m.rating.avg.toFixed(1) + " (" + m.rating.count + ")", "rating"));
    m.sharedDays.forEach((d) => chips.appendChild(createChip(d, "brand")));
    m.sharedTimes.forEach((t) => chips.appendChild(createChip(t)));
    body.appendChild(chips);
    const actions = el("div", "person-actions");
    const send = makeButton("Send request", "btn-primary btn-small", () => sendRequest(m.user, send));
    actions.appendChild(send);
    body.appendChild(actions);
    card.appendChild(body);
    host.appendChild(card);
  }
}
$("find-btn").addEventListener("click", findMatches);

// ---- Requests ----
async function sendRequest(user, btn) {
  btn.disabled = true;
  btn.textContent = "Sending...";
  try {
    await setDoc(doc(db, "requests", pairId(me.uid, user.uid)), {
      users: [me.uid, user.uid],
      fromUid: me.uid,
      toUid: user.uid,
      fromName: currentName(),
      toName: user.name,
      status: "pending",
      createdAt: serverTimestamp()
    });
    toast("Request sent to " + user.name, "success");
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Send request";
    errToast(err);
  }
}

async function respondToRequest(r, status) {
  try {
    await updateDoc(doc(db, "requests", r.id), { status });
    toast(status === "accepted" ? "You are now study partners" : "Request declined", status === "accepted" ? "success" : "info");
  } catch (err) {
    errToast(err);
  }
}

function renderRequests() {
  const host = $("requests");
  host.replaceChildren();
  const visible = requests.filter((r) => !blockedUids.has(otherUid(r)));
  const incoming = visible.filter((r) => r.toUid === me.uid && r.status === "pending");
  const outgoing = visible.filter((r) => r.fromUid === me.uid && r.status === "pending");
  updateBadges();
  if (!incoming.length && !outgoing.length) {
    host.appendChild(emptyState("No pending requests", "Requests you send or receive will show up here."));
    return;
  }
  for (const r of incoming) {
    const card = el("article", "card person");
    card.appendChild(createAvatar(r.fromName, r.fromUid, 48, photoFor(r.fromUid)));
    const body = el("div", "person-body");
    body.append(el("div", "person-name", r.fromName), el("div", "muted", "wants to study with you"));
    const actions = el("div", "person-actions");
    actions.append(
      makeButton("Accept", "btn-primary btn-small", () => respondToRequest(r, "accepted")),
      makeButton("Decline", "btn-ghost btn-small", () => respondToRequest(r, "declined"))
    );
    body.appendChild(actions);
    card.appendChild(body);
    host.appendChild(card);
  }
  for (const r of outgoing) {
    const card = el("article", "card person");
    card.appendChild(createAvatar(r.toName, r.toUid, 48, photoFor(r.toUid)));
    const body = el("div", "person-body");
    body.append(el("div", "person-name", r.toName));
    const chips = el("div", "chips");
    chips.appendChild(createChip("Waiting for reply", "warn"));
    body.appendChild(chips);
    card.appendChild(body);
    host.appendChild(card);
  }
}

// ---- Sessions ----
function allSessions() {
  const list = [];
  for (const sub of pairSubs.values()) list.push(...sub.sessions);
  return list;
}

function pairName(pid) {
  const r = requests.find((x) => x.id === pid);
  return r ? partnerOf(r) : { uid: "", name: "Partner" };
}

async function postSystemMessage(pid, text) {
  try {
    await addDoc(collection(db, "requests", pid, "messages"), {
      senderUid: me.uid, senderName: currentName(), text, createdAt: serverTimestamp()
    });
  } catch (e) { /* the session itself is already saved */ }
}

async function proposeSession(pid, partner, place = "") {
  const values = await openSessionDialog(partner.name, place);
  if (!values) return;
  try {
    await addDoc(collection(db, "requests", pid, "sessions"), {
      proposedBy: me.uid,
      proposedByName: currentName(),
      date: values.date,
      time: values.time,
      place: values.place,
      status: "proposed",
      createdAt: serverTimestamp()
    });
    toast("Session proposed to " + partner.name, "success");
    postSystemMessage(pid, "Proposed a study session: " + describeWhen(values) + ", " + values.place + ".");
  } catch (err) {
    errToast(err);
  }
}

async function setSessionStatus(s, status) {
  try {
    await updateDoc(doc(db, "requests", s.pid, "sessions", s.id), { status });
    const label = { accepted: "Session confirmed", declined: "Session declined", cancelled: "Session cancelled" }[status];
    toast(label, status === "accepted" ? "success" : "info");
    const verb = { accepted: "Accepted", declined: "Declined", cancelled: "Cancelled" }[status];
    postSystemMessage(s.pid, verb + " the study session: " + describeWhen(s) + ", " + s.place + ".");
  } catch (err) {
    errToast(err);
  }
}

async function rateSession(s, stars) {
  const partner = pairName(s.pid);
  try {
    await setDoc(doc(db, "ratings", s.id + "_" + me.uid), {
      sessionId: s.id, pairId: s.pid, rater: me.uid, ratee: partner.uid, stars, createdAt: serverTimestamp()
    });
    myRatedIds.add(s.id);
    renderSessionsEverywhere();
    toast("Thanks for rating " + partner.name, "success");
  } catch (err) {
    errToast(err);
  }
}

function downloadIcs(s, partnerName) {
  const ics = buildIcs(s, partnerName);
  if (!ics) { toast("Could not create the calendar file.", "error"); return; }
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "study-session-" + s.date + ".ics";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast("Calendar file downloaded. Open it to add the event.", "success");
}

function sessionCard(s) {
  const partner = pairName(s.pid);
  const now = new Date();
  const card = el("article", "card person session-card");
  card.appendChild(createAvatar(partner.name, partner.uid, 48));
  const body = el("div", "person-body");
  body.append(el("div", "when", describeWhen(s, now)), el("div", "muted", "with " + partner.name + " - " + s.place));
  const chips = el("div", "chips");
  const mine = s.proposedBy === me.uid;
  if (s.status === "accepted") chips.appendChild(createChip(needsRating(s, now, myRatedIds) ? "Finished" : "Confirmed", "ok"));
  else if (mine) chips.appendChild(createChip("Waiting for reply", "warn"));
  else chips.appendChild(createChip("Needs your reply", "warn"));
  body.appendChild(chips);

  const actions = el("div", "person-actions");
  if (s.status === "proposed" && !mine) {
    actions.append(
      makeButton("Accept", "btn-primary btn-small", () => setSessionStatus(s, "accepted")),
      makeButton("Decline", "btn-ghost btn-small", () => setSessionStatus(s, "declined"))
    );
  } else if (isActive(s) && isUpcoming(s, now)) {
    actions.append(makeButton("Cancel session", "btn-ghost btn-small", () => setSessionStatus(s, "cancelled")));
  }
  if (s.status === "accepted" && isUpcoming(s, now)) {
    actions.append(
      makeButton("Add to calendar", "btn-ghost btn-small", () => downloadIcs(s, partner.name)),
      makeButton("Google Calendar", "btn-ghost btn-small", () => window.open(googleCalendarUrl(s, partner.name), "_blank", "noopener"))
    );
  }
  if (actions.childNodes.length) body.appendChild(actions);

  if (needsRating(s, now, myRatedIds)) {
    const stars = el("div", "stars");
    stars.appendChild(el("span", "lbl", "How was it?"));
    for (let n = 1; n <= 5; n++) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "star-btn";
      b.textContent = "★";
      b.setAttribute("aria-label", "Rate " + n + (n === 1 ? " star" : " stars"));
      b.addEventListener("click", () => rateSession(s, n));
      stars.appendChild(b);
    }
    body.appendChild(stars);
  }
  card.appendChild(body);
  return card;
}

function renderHomeSessions() {
  const host = $("home-sessions");
  const now = new Date();
  const list = sortByStart(allSessions().filter((s) =>
    (isActive(s) && isUpcoming(s, now)) || needsRating(s, now, myRatedIds)));
  host.replaceChildren();
  if (!list.length) {
    host.appendChild(emptyState("No sessions yet", "Open a chat with a study partner and tap Plan a session."));
    return;
  }
  list.forEach((s) => host.appendChild(sessionCard(s)));
}

function renderReminder() {
  const host = $("reminder");
  if (!me) { host.hidden = true; return; }
  const s = reminderFor(allSessions(), new Date(), 24);
  if (!s) { host.hidden = true; return; }
  const partner = pairName(s.pid);
  host.replaceChildren();
  host.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a6 6 0 00-6 6v4l-2 3h16l-2-3V9a6 6 0 00-6-6zM10 20a2 2 0 004 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  host.appendChild(el("span", "", "Reminder: study with " + partner.name + " - " + describeWhen(s) + " at " + s.place));
  host.hidden = false;
}
setInterval(() => { renderReminder(); }, 60000);

function renderChatStrip() {
  const strip = $("chat-session-strip");
  if (!activePair || !pairSubs.has(activePair)) { strip.hidden = true; return; }
  const now = new Date();
  const next = sortByStart(pairSubs.get(activePair).sessions.filter((s) => isActive(s) && isUpcoming(s, now)))[0];
  if (!next) { strip.hidden = true; return; }
  const status = next.status === "accepted" ? "Confirmed" : (next.proposedBy === me.uid ? "Waiting for reply" : "Needs your reply");
  strip.textContent = "Session: " + describeWhen(next, now) + " at " + next.place + " (" + status + ")";
  strip.hidden = false;
}
$("chat-session-strip").addEventListener("click", () => showView("home"));

function renderSessionsEverywhere() {
  renderHomeSessions();
  renderReminder();
  renderChatStrip();
  updateBadges();
}

// ---- Badges / unread ----
function unreadPairs() {
  const ids = [];
  for (const [pid, sub] of pairSubs) {
    if (pid !== activePair && isUnread(sub.latest, sub.read, me.uid)) ids.push(pid);
  }
  return ids;
}

function updateBadges() {
  if (!me) return;
  const incoming = requests.filter((r) => r.toUid === me.uid && r.status === "pending" && !blockedUids.has(otherUid(r))).length;
  const sessionsForMe = pendingForMe(allSessions(), me.uid).length;
  const homeCount = incoming + sessionsForMe;
  const hb = $("nav-badge");
  hb.textContent = String(homeCount);
  hb.hidden = homeCount === 0;
  const unread = unreadPairs().length;
  const mb = $("msg-badge");
  mb.textContent = String(unread);
  mb.hidden = unread === 0;
}

let markingRead = false;
async function markRead(pid) {
  if (markingRead) return;
  markingRead = true;
  try {
    await setDoc(doc(db, "requests", pid, "reads", me.uid), { at: serverTimestamp() });
  } catch (e) { /* not critical */ }
  markingRead = false;
}

function announceNewMessages() {
  for (const [pid, sub] of pairSubs) {
    const latest = sub.latest;
    if (!latest || latest.senderUid === me.uid) continue;
    const t = tsMillis(latest.createdAt);
    if (!t || t <= startedAt || t <= (announcedMessage.get(pid) || 0)) continue;
    announcedMessage.set(pid, t);
    if (pid === activePair && !document.hidden) continue; // already looking at it
    announce(latest.senderName || pairName(pid).name, String(latest.text || "").slice(0, 80), "msg-" + pid);
  }
}

function renderUnread() {
  if (!me) return;
  announceNewMessages();
  if (activePair && pairSubs.has(activePair)) {
    const sub = pairSubs.get(activePair);
    if (isUnread(sub.latest, sub.read, me.uid)) markRead(activePair);
  }
  updateBadges();
  renderPartners();
}

// ---- Partners list + chat ----
function renderPartners() {
  const host = $("partners");
  host.replaceChildren();
  const partners = partnerPairs();
  if (!partners.length) {
    host.appendChild(emptyState("No study partners yet", "Once someone accepts your request, you can chat here."));
    return;
  }
  const lastOf = (r) => { const s = pairSubs.get(r.id); return s && s.latest ? tsMillis(s.latest.createdAt) : 0; };
  partners.sort((a, b) => lastOf(b) - lastOf(a));
  for (const r of partners) {
    const p = partnerOf(r);
    const sub = pairSubs.get(r.id);
    const unread = !!sub && isUnread(sub.latest, sub.read, me.uid);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "card person";
    btn.style.width = "100%";
    btn.style.textAlign = "left";
    btn.style.cursor = "pointer";
    btn.style.alignItems = "center";
    btn.setAttribute("aria-label", "Open chat with " + p.name + (unread ? " (unread message)" : ""));
    btn.appendChild(createAvatar(p.name, p.uid, 48, photoFor(p.uid)));
    const body = el("div", "person-body");
    const nameRow = el("div", "person-name" + (unread ? " unread" : ""), p.name);
    if (unread) { const dot = el("span", "unread-dot"); dot.setAttribute("aria-hidden", "true"); nameRow.appendChild(dot); }
    let snippet = "Tap to chat";
    if (sub && sub.latest) snippet = (sub.latest.senderUid === me.uid ? "You: " : "") + String(sub.latest.text || "");
    body.append(nameRow, el("div", "muted snippet" + (unread ? " unread" : ""), snippet));
    btn.appendChild(body);
    btn.addEventListener("click", () => openChat(r));
    host.appendChild(btn);
  }
}

function openChat(r) {
  closeChat(true);
  activePair = r.id;
  activePartner = partnerOf(r);
  $("chat-name").textContent = activePartner.name;
  $("chat-avatar").replaceChildren(createAvatar(activePartner.name, activePartner.uid, 40, photoFor(activePartner.uid)));
  $("spot-card").hidden = true;
  $("chat-menu").hidden = true;
  $("chat-menu-btn").setAttribute("aria-expanded", "false");
  $("partners-panel").hidden = true;
  $("chat-panel").hidden = false;
  $("chat-log").replaceChildren(el("div", "skeleton"));
  unsubMessages = onSnapshot(
    query(collection(db, "requests", r.id, "messages"), orderBy("createdAt"), limitToLast(100)),
    (snap) => {
      const msgs = [];
      snap.forEach((d) => msgs.push({ id: d.id, ...d.data() }));
      renderChat(msgs);
    },
    errToast
  );
  renderChatStrip();
  markRead(r.id);
  updateBadges();
  // only auto-focus on devices with a mouse, so the phone keyboard does not cover the chat
  if (window.matchMedia("(pointer: fine)").matches) $("chat-input").focus();
}

function closeChat(keepPanelState) {
  if (unsubMessages) { unsubMessages(); unsubMessages = null; }
  activePair = null;
  activePartner = null;
  if (!keepPanelState) {
    $("chat-panel").hidden = true;
    $("partners-panel").hidden = false;
    $("chat-menu").hidden = true;
  }
  if (me) { updateBadges(); renderPartners(); }
}
$("chat-back").addEventListener("click", () => closeChat());

let chatMsgs = [];
function renderChat(msgs) {
  chatMsgs = msgs;
  const log = $("chat-log");
  log.replaceChildren();
  if (!msgs.length) {
    log.appendChild(emptyState("Say hello", "Agree a time and place to study together."));
    return;
  }
  const sub = activePair ? pairSubs.get(activePair) : null;
  let lastMine = null;
  for (let i = msgs.length - 1; i >= 0; i--) { if (msgs[i].senderUid === me.uid) { lastMine = msgs[i]; break; } }
  for (const m of msgs) {
    const b = el("div", "bubble" + (m.senderUid === me.uid ? " mine" : ""));
    b.appendChild(document.createTextNode(m.text));
    b.appendChild(el("time", "", formatTime(timestampToDate(m.createdAt))));
    log.appendChild(b);
    if (m === lastMine && sub && isSeen(m, sub.partnerRead)) log.appendChild(el("div", "seen", "Seen"));
  }
  log.scrollTop = log.scrollHeight;
}

$("chat-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("chat-input");
  const text = input.value.trim();
  if (!text || !activePair) return;
  input.value = "";
  try {
    await addDoc(collection(db, "requests", activePair, "messages"), {
      senderUid: me.uid,
      senderName: currentName(),
      text: text.slice(0, 500),
      createdAt: serverTimestamp()
    });
  } catch (err) {
    input.value = text;
    errToast(err);
  }
});

$("session-btn").addEventListener("click", () => {
  if (activePair && activePartner) proposeSession(activePair, activePartner);
});

// ---- Chat menu: report / block / remove ----
function toggleMenu(open) {
  const menu = $("chat-menu");
  const show = open === undefined ? menu.hidden : open;
  menu.hidden = !show;
  $("chat-menu-btn").setAttribute("aria-expanded", String(show));
}
$("chat-menu-btn").addEventListener("click", (e) => { e.stopPropagation(); toggleMenu(); });
document.addEventListener("click", (e) => {
  if (!$("chat-menu").hidden && !e.target.closest(".chat-menu-wrap")) toggleMenu(false);
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") toggleMenu(false); });

let endingByMe = false;
async function endPartnership(reason) {
  const partner = activePartner;
  const pid = activePair;
  if (!partner) return false;
  endingByMe = true;
  try {
    await setDoc(doc(db, "blocks", me.uid + "_" + partner.uid), {
      blocker: me.uid, blocked: partner.uid, pairId: pid, reason, createdAt: serverTimestamp()
    });
    return true;
  } catch (err) {
    errToast(err);
    return false;
  } finally {
    setTimeout(() => { endingByMe = false; }, 500);
  }
}

$("m-block").addEventListener("click", async () => {
  toggleMenu(false);
  const partner = activePartner;
  if (!partner) return;
  const res = await openDialog({
    title: "Block " + partner.name + "?",
    text: "You will no longer see each other in matches and you cannot message each other. This cannot be undone.",
    okLabel: "Block", danger: true
  });
  if (!res) return;
  if (await endPartnership("blocked")) { closeChat(); toast(partner.name + " has been blocked.", "info"); }
});

$("m-remove").addEventListener("click", async () => {
  toggleMenu(false);
  const partner = activePartner;
  if (!partner) return;
  const res = await openDialog({
    title: "Remove " + partner.name + "?",
    text: "This ends your study partnership and closes the chat. They will not be told why.",
    okLabel: "Remove partner", danger: true
  });
  if (!res) return;
  if (await endPartnership("removed")) { closeChat(); toast(partner.name + " was removed.", "info"); }
});

$("m-report").addEventListener("click", async () => {
  toggleMenu(false);
  const partner = activePartner;
  const pid = activePair;
  if (!partner) return;
  const res = await openDialog({
    title: "Report " + partner.name,
    text: "Tell us what happened. Reports are private and reviewed by the CampusMate team.",
    okLabel: "Send report", danger: true,
    textarea: { label: "What happened?", required: true },
    checkbox: { label: "Also block this person", checked: true }
  });
  if (!res) return;
  try {
    await addDoc(collection(db, "reports"), {
      reporter: me.uid, reported: partner.uid, pairId: pid, reason: res.text.slice(0, 300), createdAt: serverTimestamp()
    });
    toast("Report sent. Thank you.", "success");
  } catch (err) {
    errToast(err);
    return;
  }
  if (res.checked && (await endPartnership("blocked"))) closeChat();
});

// ---- Study groups ----
function subscribeGroups() {
  unsubs.push(onSnapshot(query(collection(db, "groups"), where("members", "array-contains", me.uid)),
    (snap) => {
      groups = [];
      snap.forEach((d) => groups.push({ id: d.id, ...d.data() }));
      groups.sort((a, b) => String(a.name).localeCompare(String(b.name)));
      renderGroups();
      if (activeGroup && !groups.some((g) => g.id === activeGroup)) closeGroup();
    }, errToast));
}

function renderGroups() {
  const host = $("groups");
  host.replaceChildren();
  if (!groups.length) {
    host.appendChild(emptyState("No study groups yet", "Create one with up to 4 of your study partners."));
    return;
  }
  for (const g of groups) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "card person group-card";
    btn.style.cssText = "width:100%;text-align:left;cursor:pointer;align-items:center";
    btn.setAttribute("aria-label", "Open group " + g.name);
    btn.appendChild(createAvatar(g.name, g.id, 48));
    const body = el("div", "person-body");
    body.append(el("div", "person-name", g.name), el("div", "muted snippet", memberLabel(g, me.uid)));
    btn.appendChild(body);
    btn.addEventListener("click", () => openGroup(g));
    host.appendChild(btn);
  }
}

function openGroup(g) {
  closeChat(true);
  closeGroup(true);
  activeGroup = g.id;
  $("group-name").textContent = g.name;
  $("group-sub").textContent = (g.members || []).length + " people";
  $("group-avatar").replaceChildren(createAvatar(g.name, g.id, 40));
  $("partners-panel").hidden = true;
  $("chat-panel").hidden = true;
  $("group-panel").hidden = false;
  $("group-log").replaceChildren(el("div", "skeleton"));
  unsubGroupMsgs = onSnapshot(
    query(collection(db, "groups", g.id, "messages"), orderBy("createdAt"), limitToLast(100)),
    (snap) => {
      const msgs = [];
      snap.forEach((d) => msgs.push({ id: d.id, ...d.data() }));
      renderGroupChat(msgs);
    },
    errToast
  );
  if (window.matchMedia("(pointer: fine)").matches) $("group-input").focus();
}

function closeGroup(keepPanelState) {
  if (unsubGroupMsgs) { unsubGroupMsgs(); unsubGroupMsgs = null; }
  activeGroup = null;
  if (!keepPanelState) {
    $("group-panel").hidden = true;
    if (me && $("chat-panel").hidden) $("partners-panel").hidden = false;
  }
}
$("group-back").addEventListener("click", () => closeGroup());

function renderGroupChat(msgs) {
  const log = $("group-log");
  log.replaceChildren();
  if (!msgs.length) {
    log.appendChild(emptyState("Start the conversation", "Everyone in the group can see what you write here."));
    return;
  }
  for (const m of msgs) {
    const mine = m.senderUid === me.uid;
    const b = el("div", "bubble" + (mine ? " mine" : ""));
    if (!mine) b.appendChild(el("span", "who", m.senderName || "Member"));
    b.appendChild(document.createTextNode(m.text));
    b.appendChild(el("time", "", formatTime(timestampToDate(m.createdAt))));
    log.appendChild(b);
  }
  log.scrollTop = log.scrollHeight;
}

$("group-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("group-input");
  const text = input.value.trim();
  if (!text || !activeGroup) return;
  input.value = "";
  try {
    await addDoc(collection(db, "groups", activeGroup, "messages"), {
      senderUid: me.uid, senderName: currentName(), text: text.slice(0, 500), createdAt: serverTimestamp()
    });
  } catch (err) {
    input.value = text;
    errToast(err);
  }
});

$("group-leave").addEventListener("click", async () => {
  const g = groups.find((x) => x.id === activeGroup);
  if (!g) return;
  const res = await openDialog({
    title: "Leave " + g.name + "?",
    text: canLeaveByDelete(g, me.uid) ? "You are the last member, so the group will be deleted." : "You will stop receiving messages from this group.",
    okLabel: "Leave group", danger: true
  });
  if (!res) return;
  const gid = g.id;
  try {
    if (canLeaveByDelete(g, me.uid)) await deleteDoc(doc(db, "groups", gid));
    else await updateDoc(doc(db, "groups", gid), { members: arrayRemove(me.uid) });
    closeGroup();
    toast("You left " + g.name, "info");
  } catch (err) {
    errToast(err);
  }
});

function openGroupDialog() {
  const partners = partnerPairs().map(partnerOf);
  if (!partners.length) { toast("Accept a study partner first, then you can make a group.", "info"); return; }
  const dlg = $("group-dlg");
  if (typeof dlg.showModal !== "function") { toast("Your browser does not support this dialog.", "error"); return; }
  $("g-name").value = "";
  $("g-error").textContent = "";
  const list = $("g-members");
  list.replaceChildren();
  for (const p of partners) {
    const row = el("label", "check-row");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = p.uid;
    row.append(box, createAvatar(p.name, p.uid, 32, photoFor(p.uid)), el("span", "", p.name));
    list.appendChild(row);
  }
  $("g-cancel").onclick = () => dlg.close();
  $("g-ok").onclick = async () => {
    const name = $("g-name").value;
    const chosen = [...list.querySelectorAll("input:checked")].map((i) => i.value);
    const problem = validateGroupName(name) || validateGroupMembers(chosen);
    if (problem) { $("g-error").textContent = problem; return; }
    const others = partners.filter((p) => chosen.includes(p.uid));
    const btn = $("g-ok");
    btn.disabled = true;
    try {
      const data = buildGroup({ name, module: profile ? profile.module : "", ownerUid: me.uid, ownerName: currentName(), others });
      await addDoc(collection(db, "groups"), { ...data, createdAt: serverTimestamp() });
      dlg.close();
      toast("Group created", "success");
    } catch (err) {
      $("g-error").textContent = friendlyError(err);
    } finally {
      btn.disabled = false;
    }
  };
  dlg.showModal();
}
$("group-new").addEventListener("click", openGroupDialog);

// ---- Study places map (Leaflet + OpenStreetMap + Overpass) ----
const LEAFLET_VERSION = "1.9.4";
const LEAFLET_BASE = "https://cdn.jsdelivr.net/npm/leaflet@" + LEAFLET_VERSION + "/dist/";
const LEAFLET_CSS_SRI = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
const LEAFLET_JS_SRI = "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=";
const KIND_COLOURS = { library: "#3366CC", cafe: "#B4442B", park: "#2E7D32" };
let leafletPromise = null;
let mapObj = null, mapLayer = null, mapPos = null, mapPlaces = [], mapKind = "all", mapFetchedAt = 0;

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = LEAFLET_BASE + "leaflet.css";
    css.integrity = LEAFLET_CSS_SRI;
    css.crossOrigin = "";
    document.head.appendChild(css);
    const js = document.createElement("script");
    js.src = LEAFLET_BASE + "leaflet.js";
    js.integrity = LEAFLET_JS_SRI;
    js.crossOrigin = "";
    js.onload = () => (window.L ? resolve(window.L) : reject(new Error("leaflet")));
    js.onerror = () => { leafletPromise = null; reject(new Error("leaflet")); };
    document.head.appendChild(js);
  });
  return leafletPromise;
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject({ code: 0 }); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (err) => reject(err),
      { timeout: 10000, maximumAge: 600000 }
    );
  });
}

// The free Overpass servers are sometimes busy, so try the next one if a server fails or is slow.
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];

async function fetchPlaces(pos) {
  const body = "data=" + encodeURIComponent(buildOverpassQuery(pos.lat, pos.lon, 1500));
  let lastError = null;
  for (const url of OVERPASS_URLS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: ctrl.signal
      });
      if (!res.ok) throw new Error("overpass " + res.status);
      return parsePlaces(await res.json(), pos.lat, pos.lon);
    } catch (e) {
      lastError = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("overpass");
}

function setMapStatus(text) { $("map-status").textContent = text; }

function renderMapPlaces() {
  const L = window.L;
  const list = filterByKind(mapPlaces, mapKind);
  mapLayer.clearLayers();
  L.circleMarker([mapPos.lat, mapPos.lon], { radius: 8, color: "#fff", weight: 3, fillColor: "#16213A", fillOpacity: 1 })
    .bindTooltip("You are here").addTo(mapLayer);
  const host = $("map-list");
  host.replaceChildren();
  for (const p of list) {
    const marker = L.circleMarker([p.lat, p.lon], { radius: 10, color: "#fff", weight: 2, fillColor: KIND_COLOURS[p.kind], fillOpacity: 0.95 }).addTo(mapLayer);
    const pop = el("div", "map-pop");
    pop.append(el("strong", "", p.name), document.createElement("br"), document.createTextNode(KINDS[p.kind] + " - " + formatDistance(p.distance)));
    if (activePair && activePartner) {
      pop.appendChild(document.createElement("br"));
      pop.appendChild(makeButton("Plan a session here", "btn-primary btn-small", () => {
        $("map-dlg").close();
        proposeSession(activePair, activePartner, p.name.slice(0, 60));
      }));
    }
    marker.bindPopup(pop);
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    const nm = el("span", "pname", p.name);
    b.append(nm, el("small", "", KINDS[p.kind] + " - " + formatDistance(p.distance)));
    b.addEventListener("click", () => { mapObj.setView([p.lat, p.lon], 17); marker.openPopup(); });
    li.appendChild(b);
    host.appendChild(li);
  }
  if (!mapPlaces.length) setMapStatus("No libraries, cafes or parks found within 1.5 km. Try again from another place.");
  else if (!list.length) setMapStatus("Nothing of that type within 1.5 km. Try \"All\".");
  else setMapStatus(list.length + (list.length === 1 ? " place" : " places") + " within 1.5 km, nearest first.");
}

async function openMap() {
  const dlg = $("map-dlg");
  if (typeof dlg.showModal !== "function") { toast("Your browser does not support the map.", "error"); return; }
  if (!dlg.open) dlg.showModal();
  setMapStatus("Finding your location...");
  let L, pos;
  try {
    L = await loadLeaflet();
  } catch (e) {
    setMapStatus("The map could not load. Check your internet connection and try again.");
    return;
  }
  try {
    pos = await getPosition();
  } catch (e) {
    setMapStatus(e && e.code === 1
      ? "Location permission was denied. Allow location for this site to see study places near you."
      : "Could not find your location. Try again outdoors or near a window.");
    return;
  }
  if (!mapObj) {
    mapObj = L.map("map-canvas", { zoomControl: true, attributionControl: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: "&copy; OpenStreetMap contributors"
    }).addTo(mapObj);
    mapLayer = L.layerGroup().addTo(mapObj);
  }
  mapObj.setView([pos.lat, pos.lon], 15);
  setTimeout(() => mapObj.invalidateSize(), 80);
  const moved = !mapPos || Math.abs(mapPos.lat - pos.lat) > 0.002 || Math.abs(mapPos.lon - pos.lon) > 0.002;
  mapPos = pos;
  if (moved || Date.now() - mapFetchedAt > 10 * 60 * 1000) {
    setMapStatus("Searching nearby...");
    try {
      mapPlaces = await fetchPlaces(pos);
      mapFetchedAt = Date.now();
    } catch (e) {
      mapPlaces = [];
      mapLayer.clearLayers();
      $("map-list").replaceChildren();
      setMapStatus("Could not load nearby places right now. Please try again in a moment.");
      return;
    }
  }
  renderMapPlaces();
}

document.querySelectorAll(".map-filter button").forEach((b) => {
  b.addEventListener("click", () => {
    mapKind = b.dataset.kind;
    document.querySelectorAll(".map-filter button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    if (mapObj && mapPos && (mapPlaces.length || mapFetchedAt)) renderMapPlaces();
  });
});
$("map-open").addEventListener("click", openMap);
$("map-btn").addEventListener("click", openMap);
$("map-close").addEventListener("click", () => $("map-dlg").close());

// ---- Weather-based meeting spot ----
const WEATHER = [
  [[0], "clear sky"], [[1, 2, 3], "cloudy"], [[45, 48], "foggy"],
  [[51, 53, 55, 56, 57], "drizzly"], [[61, 63, 65, 66, 67, 80, 81, 82], "rainy"],
  [[71, 73, 75, 77, 85, 86], "snowy"], [[95, 96, 99], "stormy"]
];
function describeWeather(code) {
  for (const [codes, label] of WEATHER) if (codes.includes(code)) return label;
  return "mixed weather";
}
function chooseSpot(temp, code) {
  const wet = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99].includes(code);
  if (wet) return "the library or a quiet indoor study room";
  if (temp < 6) return "a warm cafe near campus";
  if (temp >= 14 && code <= 3) return "a bench or lawn on campus";
  return "a campus cafe";
}

$("spot-btn").addEventListener("click", () => {
  const card = $("spot-card");
  card.hidden = false;
  card.textContent = "Checking the weather near you...";
  if (!navigator.geolocation) { card.textContent = "Location is not available on this device."; return; }
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude.toFixed(2);
      const lon = pos.coords.longitude.toFixed(2);
      try {
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code`);
        if (!res.ok) throw new Error("weather " + res.status);
        const data = await res.json();
        const t = Math.round(data.current.temperature_2m);
        const code = data.current.weather_code;
        card.textContent = `It is ${t}°C and ${describeWeather(code)} right now. How about ${chooseSpot(t, code)}?`;
      } catch (err) {
        card.textContent = "Could not get the weather. Try the library or a campus cafe.";
      }
    },
    () => { card.textContent = "Location permission was denied. Try the library or a campus cafe."; },
    { timeout: 10000, maximumAge: 600000 }
  );
});

// ---- Auth state ----
function cleanupSession() {
  unsubs.forEach((u) => u());
  unsubs = [];
  for (const sub of pairSubs.values()) sub.unsubs.forEach((u) => u());
  pairSubs.clear();
  closeChat();
  closeGroup();
  groups = [];
  photoCache.clear();
  photoLoading.clear();
  pendingPhoto = "";
  requests = [];
  blockedUids = new Set();
  myRatedIds = new Set();
  lastMatches = null;
  profile = null;
  requestsReady = false;
  prevRequestStatus.clear();
  announcedMessage.clear();
  reminded.clear();
  startedAt = Date.now();
}

onAuthStateChanged(auth, async (user) => {
  cleanupSession();
  me = user;
  if (!user) {
    unlockApp();
    $("app-section").hidden = true;
    $("auth-section").hidden = false;
    $("auth-form").reset();
    setAuthMode("login");
    return;
  }
  $("auth-section").hidden = true;
  $("app-section").hidden = false;
  if (bioEnabled()) lockApp(true);
  await loadProfile();
  const name = currentName();
  renderAppbar(name);
  renderGreeting(name);
  renderSummary();
  fillProfileForm(profile);
  updateInstallCard();
  updateNotifyUi();
  updateBioUi();
  updateVerifyUi();
  subscribeBlocks();
  subscribeRatings();
  subscribeRequests();
  subscribeGroups();
  if (profile) {
    showView("home");
    findMatches();
  } else {
    showView("profile");
    toast("Welcome! Set up your profile to find partners.");
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch((e) => console.warn("SW failed", e));
  });
}
