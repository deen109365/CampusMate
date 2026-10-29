import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, doc, setDoc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

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

const loginForm = document.getElementById("login-form");
const signupForm = document.getElementById("signup-form");
const authSection = document.getElementById("auth-section");
const appSection = document.getElementById("app-section");
const message = document.getElementById("message");
const welcome = document.getElementById("welcome");

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

onAuthStateChanged(auth, (user) => {
  if (user) {
    authSection.hidden = true;
    appSection.hidden = false;
    showWelcome(user);
  } else {
    appSection.hidden = true;
    authSection.hidden = false;
    loginForm.hidden = false;
    signupForm.hidden = true;
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js")
      .then(() => console.log("Service worker registered"))
      .catch((err) => console.error("Service worker failed:", err));
  });
}