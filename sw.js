// Service worker A.E.G.I.S.: agar bisa di-install ke layar utama dan terbuka cepat/offline.
// - Halaman, JS, CSS: network-first (selalu versi terbaru bila online, cadangan cache bila offline)
// - Model AI, WASM, ikon: cache-first (besar dan jarang berubah)
// - /api/* tidak pernah di-cache (chat AI harus selalu live)
const VERSION = "aegis-v1";
const SHELL = "aegis-shell-" + VERSION;
const HEAVY = "aegis-heavy-" + VERSION;
const HEAVY_RE = /\/(models|icons)\/|\/node_modules\/@mediapipe\//;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(["./", "index.html", "style.css", "script.js"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, HEAVY].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname === "/healthz") return;

  if (HEAVY_RE.test(url.pathname)) {
    e.respondWith(
      caches.open(HEAVY).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === "navigate" ? caches.match("index.html") : Response.error()))),
  );
});
