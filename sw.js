// רשת קודם (תמיד הגרסה העדכנית), ומטמון רק כשאין אינטרנט.
const CACHE = "pitch-v5";
const FILES = ["./", "index.html", "song.html", "external.html", "style.css", "pitch.js", "app.js", "song.js", "songs.js", "external.js", "manifest.webmanifest", "icons/icon.svg"];
self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))); });
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(fetch(e.request).then((r) => {
    const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request)));
});
