/* BillShield service worker: caches the app shell so the rules-only audit, on-device scrub,
 * leak gate and template letter work offline. It never caches or intercepts cross-origin
 * requests (Firebase AI Logic, Firestore, Remote Config, App Check, reCAPTCHA): cloud letter
 * writing needs the network and is never served from cache. Plain JS so it runs as-is. */
const CACHE = "billshield-shell-v1";
const SHELL = ["/", "/eval", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/eval/results.json"];

/** Pull same-origin hashed build assets (/_next/static/...) out of an HTML page. */
function extractAssets(html) {
  const out = new Set();
  for (const m of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"?#]+)"/g)) out.add(m[1]);
  return [...out];
}

/** Routing policy: "bypass" (browser handles it), "cache-first" or "network-first". */
function route(req, origin) {
  if (req.method !== "GET") return "bypass";
  const u = new URL(req.url);
  if (u.origin !== origin) return "bypass"; // Firebase / Google APIs: never cached
  if (u.pathname.startsWith("/_next/static/") || u.pathname.startsWith("/icons/")) return "cache-first";
  return "network-first";
}

if (typeof module !== "undefined" && module.exports) module.exports = { CACHE, SHELL, extractAssets, route };

if (typeof ServiceWorkerGlobalScope !== "undefined" && self instanceof ServiceWorkerGlobalScope) {
  self.addEventListener("install", (event) => {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE);
      const assets = new Set();
      for (const path of SHELL) {
        try {
          const res = await fetch(path, { cache: "reload" });
          if (!res.ok) continue;
          if ((res.headers.get("content-type") || "").includes("text/html")) for (const a of extractAssets(await res.clone().text())) assets.add(a);
          await cache.put(path, res);
        } catch { /* offline during install: skip */ }
      }
      await Promise.all([...assets].map((a) => cache.add(a).catch(() => undefined)));
      await self.skipWaiting();
    })());
  });
  self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
      for (const k of await caches.keys()) if (k.startsWith("billshield-") && k !== CACHE) await caches.delete(k);
      await self.clients.claim();
    })());
  });
  self.addEventListener("fetch", (event) => {
    const req = event.request;
    const how = route(req, self.location.origin);
    if (how === "bypass") return;
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      if (how === "cache-first") {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok && res.type === "basic") cache.put(req, res.clone());
        return res;
      }
      try {
        const res = await fetch(req);
        if (res.ok && res.type === "basic") cache.put(req, res.clone());
        return res;
      } catch (e) {
        const hit = await cache.match(req, { ignoreVary: true });
        if (hit) return hit;
        if (req.mode === "navigate") { const shell = await cache.match("/"); if (shell) return shell; }
        throw e;
      }
    })());
  });
}
