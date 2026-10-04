// ag-dash's service worker (https pages and the home screen app only; browsers allow none on plain http):
// the page and its bundles are kept, so the app opens even while ag-dash restarts or the network is down, and
// the board and transcripts come from the page's own device copy. The API and the event stream always go to the
// network.
const CACHE = "ag-dash-v1";
// Keep a copy of a response (taken before the browser starts reading it) and hand the response on.
const keep = (key, r) => {
  if (r.ok) {
    const copy = r.clone();
    caches.open(CACHE).then((c) => c.put(key, copy)).catch(() => {});
  }
  return r;
};
// The network first; the kept copy when it can't be reached, or answers 5xx (tailscale serve says 502 while ag-dash
// restarts).
const fresh = (req, key) =>
  fetch(req)
    .then((r) => (r.status >= 500 ? caches.match(key).then((c) => c || r) : keep(key, r)))
    .catch(() => caches.match(key).then((c) => c || Response.error()));
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  // Bundles have content-hashed names: cached for good.
  if (u.pathname.startsWith("/assets/")) {
    e.respondWith(caches.open(CACHE).then(async (c) => (await c.match(e.request)) || fetch(e.request).then((r) => (r.ok && c.put(e.request, r.clone()), r))));
    return;
  }
  // Static files (icons, telemetry.js) keep their names: the network first, the kept copy when it can't be reached.
  if (u.pathname.startsWith("/static/")) {
    e.respondWith(fresh(e.request, e.request));
    return;
  }
  // The page: the network first (so a new version shows at once), the kept copy when it can't be reached.
  if (e.request.mode === "navigate" && u.pathname.startsWith("/chat")) {
    e.respondWith(fresh(e.request, "/chat"));
  }
});
