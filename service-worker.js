// Network-first service worker: always tries the network, falls back to cache offline.
const CACHE = "campusmate-v7";
const FIREBASE_CDN = "https://www.gstatic.com/firebasejs/";
const LEAFLET_CDN = "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/"; // versioned, never changes
const SHELL = [
  "./", "./index.html", "./style.css", "./app.js", "./ui.js", "./matching.js", "./sessions.js", "./groups.js", "./places.js",
  "./manifest.json", "./icon-192.png", "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  // Firebase SDK and Leaflet files are versioned and never change, so serve them cache-first (works offline)
  if (req.url.startsWith(FIREBASE_CDN) || req.url.startsWith(LEAFLET_CDN)) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
        return res;
      }))
    );
    return;
  }
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch Firebase data / Open-Meteo
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === "navigate" ? caches.match("./index.html") : Response.error())))
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ("focus" in c) return c.focus(); }
      return self.clients.openWindow("./index.html");
    })
  );
});
