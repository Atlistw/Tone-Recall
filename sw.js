const CACHE = "tone-recall-v20";
const ASSETS = [
  "./index.html",
  "./src/styles.css?v=20",
  "./src/supabase-config.js?v=20",
  "./src/sync-core.js?v=20",
  "./src/supabase-sync-adapter.js?v=20",
  "./src/manual-sync.js?v=20",
  "./src/app.js?v=20",
  "./manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((name) => name !== CACHE).map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  const shouldRefresh = event.request.mode === "navigate" ||
    ["document", "script", "style", "manifest"].includes(event.request.destination);

  if (!shouldRefresh) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
