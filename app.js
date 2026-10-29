import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, serverTimestamp,
  collection, query, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

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
const db = getFirestore(app);

// ---------- Page elements ----------
const loginForm = document.getElementById("login-form");
const signupForm = document.getElementById("signup-form");
const authSection = document.getElementById("auth-section");
const appSection = document.getElementById("app-section");
const message = document.getElementById("message");
const welcome = document.getElementById("welcome");
const profileForm = document.getElementById("profile-form");
const profileMessage = document.getElementById("profile-message");
const matchList = document.getElementById("match-list");
const matchMessage = document.getElementById("match-message");

function showMessage(text) { message.textContent = text; }

function friendlyError(code) {
  const errors = {
    "auth/email-already-in-use": "That email is already registered. Try logging in.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/invalid-credential": "Wrong email or password.",
    "auth/too-many-requests": "Too many attempts. Please wait and try again."
  };
  return errors[code] || "Something went wrong. Please try again.";
}

function showWelcome(user) {
  welcome.textContent = "Welcome, " + (user.displayName || user.email);
}

// ---------- Sign up / log in / log out ----------
document.getElementById("show-signup").addEventListener("click", () => {
  loginForm.hidden = true; signupForm.hidden = false; showMessage("");
});
document.getElementById("show-login").addEventListener("click", () => {
  signupForm.hidden = true; loginForm.hidden = false; showMessage("");
});

signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("signup-name").value.trim();
  const email = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });
    await setDoc(doc(db, "users", cred.user.uid), {
      name, email, createdAt: serverTimestamp()
    });
    showWelcome(cred.user);
    showMessage("");
  } catch (err) {
    showMessage(friendlyError(err.code));
  }
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
    showMessage("");
  } catch (err) {
    showMessage(friendlyError(err.code));
  }
});

document.getElementById("logout-btn").addEventListener("click", () => signOut(auth));

// ---------- Profile: save, load, local copy ----------
const localKey = (uid) => "campusmate-profile-" + uid;

function readProfileFromForm() {
  const checked = (name) =>
    [...profileForm.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);
  const format = profileForm.querySelector('input[name="format"]:checked');
  return {
    module: document.getElementById("profile-module").value.trim().toUpperCase().replace(/\s+/g, ""),
    days: checked("days"),
    times: checked("times"),
    format: format ? format.value : ""
  };
}

function fillProfileForm(profile) {
  document.getElementById("profile-module").value = profile.module || "";
  profileForm.querySelectorAll('input[name="days"]').forEach((i) => {
    i.checked = (profile.days || []).includes(i.value);
  });
  profileForm.querySelectorAll('input[name="times"]').forEach((i) => {
    i.checked = (profile.times || []).includes(i.value);
  });
  profileForm.querySelectorAll('input[name="format"]').forEach((i) => {
    i.checked = i.value === profile.format;
  });
}

async function loadProfile(user) {
  // Show the local copy straight away so the form is never empty
  try {
    const cached = localStorage.getItem(localKey(user.uid));
    if (cached) fillProfileForm(JSON.parse(cached));
  } catch (err) { /* local storage unavailable: ignore */ }

  // Then get the latest from Firestore
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) {
      const data = snap.data();
      if (data.module) {
        fillProfileForm(data);
        try { localStorage.setItem(localKey(user.uid), JSON.stringify(data)); } catch (err) {}
      }
    }
  } catch (err) {
    profileMessage.textContent = "Offline: showing your saved copy.";
  }
}

profileForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const user = auth.currentUser;
  if (!user) return;
  const profile = readProfileFromForm();

  if (profile.days.length === 0 || profile.times.length === 0) {
    profileMessage.textContent = "Please choose at least one day and one time.";
    return;
  }

  try {
    await setDoc(doc(db, "users", user.uid), {
      name: user.displayName || "",
      email: user.email,
      ...profile,
      updatedAt: serverTimestamp()
    }, { merge: true });
    try { localStorage.setItem(localKey(user.uid), JSON.stringify(profile)); } catch (err) {}
    profileMessage.textContent = "Profile saved.";
  } catch (err) {
    profileMessage.textContent = "Could not save. Check your connection and try again.";
  }
});

// ---------- Matching: same module + overlapping time + compatible format ----------
function overlap(a = [], b = []) {
  return a.filter((x) => b.includes(x));
}

function formatsCompatible(a, b) {
  if (a === "Either" || b === "Either") return true;
  return a === b;
}

function renderMatches(matches) {
  matchList.innerHTML = "";
  matches.forEach((m) => {
    const li = document.createElement("li");
    li.className = "match-card";

    const name = document.createElement("strong");
    name.textContent = m.name || "A classmate";

    const details = document.createElement("span");
    details.textContent =
      m.module + " · " + m.format + " · " +
      m.sharedDays.join(", ") + " (" + m.sharedTimes.join(", ") + ")";

    li.append(name, details);
    matchList.appendChild(li);
  });
}

async function findMatches() {
  const user = auth.currentUser;
  if (!user) return;
  matchMessage.textContent = "Looking for study partners...";
  matchList.innerHTML = "";

  try {
    // Use the saved profile, so matching reflects what is stored
    const mySnap = await getDoc(doc(db, "users", user.uid));
    const me = mySnap.exists() ? mySnap.data() : null;
    if (!me || !me.module || !me.days || !me.times || !me.format) {
      matchMessage.textContent = "Save your profile first, then find matches.";
      return;
    }

    const q = query(collection(db, "users"), where("module", "==", me.module));
    const snap = await getDocs(q);

    const matches = [];
    snap.forEach((d) => {
      if (d.id === user.uid) return;            // skip yourself
      const other = d.data();
      const sharedDays = overlap(me.days, other.days);
      const sharedTimes = overlap(me.times, other.times);
      if (sharedDays.length === 0 || sharedTimes.length === 0) return;
      if (!formatsCompatible(me.format, other.format)) return;
      matches.push({
        name: other.name,
        module: other.module,
        format: other.format,
        sharedDays,
        sharedTimes,
        score: sharedDays.length * sharedTimes.length
      });
    });

    matches.sort((a, b) => b.score - a.score);

    if (matches.length === 0) {
      matchMessage.textContent = "No matches yet. Try adding more days or times.";
    } else {
      matchMessage.textContent = matches.length + " study partner(s) found.";
      renderMatches(matches);
    }
  } catch (err) {
    console.error(err);
    matchMessage.textContent = "Could not load matches. Check your connection.";
  }
}

document.getElementById("find-matches").addEventListener("click", findMatches);

// ---------- Show the right screen ----------
onAuthStateChanged(auth, (user) => {
  if (user) {
    authSection.hidden = true;
    appSection.hidden = false;
    showWelcome(user);
    profileMessage.textContent = "";
    matchMessage.textContent = "";
    matchList.innerHTML = "";
    loadProfile(user);
  } else {
    appSection.hidden = true;
    authSection.hidden = false;
    loginForm.hidden = false;
    signupForm.hidden = true;
    profileForm.reset();
    matchMessage.textContent = "";
    matchList.innerHTML = "";
  }
});

// ---------- Service worker (makes the app installable) ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js")
      .then(() => console.log("Service worker registered"))
      .catch((err) => console.error("Service worker failed:", err));
  });
}
