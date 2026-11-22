// Network first (always the latest code), cache only as an offline fallback.
const CACHE = "pitch-v10";
const FILES = [
  "./", "index.html", "css/app.css", "manifest.webmanifest", "icons/icon.svg",
  "src/app.js",
  "src/core/signal.js", "src/core/music-theory.js", "src/core/pitch-detector.js", "src/core/pitch-smoother.js",
  "src/core/chroma.js", "src/core/key-estimation.js", "src/core/key-tracker.js", "src/core/external-session.js",
  "src/core/session-stats.js", "src/core/song-timeline.js", "src/core/song-judge.js", "src/core/feedback.js",
  "src/core/settings.js", "src/core/mic-help.js", "src/core/songs.js",
  "src/audio/microphone.js", "src/audio/mic-tap.js", "src/audio/backing-synth.js", "src/audio/wake-lock.js",
  "src/ui/dom.js", "src/ui/icons.js", "src/ui/led-meter.js", "src/ui/pitch-trace.js", "src/ui/piano-roll.js",
  "src/ui/readout.js", "src/ui/controls.js", "src/ui/listening-session.js", "src/ui/summary-card.js",
  "src/modes/tuner-mode.js", "src/modes/song-mode.js", "src/modes/karaoke-mode.js",
];
self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))); });
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(fetch(e.request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return response;
  }).catch(() => caches.match(e.request)));
});
