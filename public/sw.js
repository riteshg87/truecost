/**
 * Minimal offline shell for TrueCost.
 *
 * Everything the app does is local arithmetic, so once the bundle is cached the
 * app works with no network at all. Strategy: network-first for documents (so a
 * deploy is picked up promptly), stale-while-revalidate for hashed static
 * assets, and the welcome screen as the last-resort fallback.
 *
 * v2 fixes a real bug in v1: every navigation was cached under "/" regardless
 * of which page had been fetched, so hard-loading any screen overwrote the
 * offline shell with that screen's HTML. Opening the app offline then showed
 * whatever page you happened to visit last, at the wrong URL. Documents are now
 * cached under their own address, and "/" is only the fallback when the
 * requested page was never seen.
 */
const CACHE = "truecost-v2";
const OFFLINE_URL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      // Dropping every other cache is what clears the poisoned "/" entry v1
      // left behind on devices that already installed it.
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            // Under its own address, so every screen can come back offline as
            // itself rather than as whichever was loaded most recently.
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          caches
            .match(request)
            .then((hit) => hit ?? caches.match(OFFLINE_URL))
            .then((hit) => hit ?? Response.error()),
        ),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached ?? Response.error());
      return cached ?? network;
    }),
  );
});
