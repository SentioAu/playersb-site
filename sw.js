/* PlayersB service worker.
   - Stale-while-revalidate for HTML and data JSON (fast paint, fresh next load)
   - Cache-first for /styles/, /assets/, fonts (with revalidation)
   - Bypass for analytics + non-GET */
const VERSION = "playersb-sw-v2";
const STATIC_CACHE = "playersb-static-" + VERSION;
const RUNTIME_CACHE = "playersb-runtime-" + VERSION;

const PRECACHE = [
  "/",
  "/players/",
  "/compare/",
  "/tools/",
  "/learn/",
  "/styles/site.css",
  "/assets/js/site.js",
  "/favicon.svg",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE).catch(() => null)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k)),
      ),
    ).then(() => self.clients.claim()),
  );
});

function isAnalytics(url) {
  return /googletagmanager\.com|google-analytics\.com|analytics\.google\.com/.test(url.hostname);
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res && res.ok && res.type !== "opaque") {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    })
    .catch(() => null);
  return cached || network || Response.error();
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req).catch(() => null);
  if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
  return res || Response.error();
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (isAnalytics(url)) return;

  // Same-origin static assets: cache-first.
  if (url.origin === self.location.origin) {
    if (
      url.pathname.startsWith("/styles/") ||
      url.pathname.startsWith("/assets/") ||
      url.pathname === "/favicon.svg" ||
      url.pathname === "/og-image.svg" ||
      url.pathname === "/manifest.webmanifest"
    ) {
      event.respondWith(cacheFirst(req, STATIC_CACHE));
      return;
    }
    if (url.pathname.startsWith("/data/")) {
      event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
      return;
    }
    // HTML / nav requests
    if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
      event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
      return;
    }
  }

  // Google Fonts: cache-first.
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
  }
});
