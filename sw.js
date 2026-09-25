/* Offline shell. Network first so a new deploy shows up on the next visit;
   the cache is only the fallback when there is no network. */

const VERSION = "dayshaper-v2.0.0";
const SHELL = [
  "./", "index.html", "manifest.webmanifest",
  "styles/tokens.css", "styles/app.css", "fonts/inter-var.woff2",
  "src/main.js", "src/engine.js", "src/time.js", "src/solar.js", "src/color.js", "src/sky.js",
  "src/types.js", "src/context.js", "src/store.js", "src/icons.js", "src/scene.js", "src/dial.js",
  "icons/icon.svg", "icons/icon-192.png", "icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: req.mode === "navigate" })
        .then((hit) => hit || (req.mode === "navigate" ? caches.match("index.html") : Response.error()))),
  );
});
