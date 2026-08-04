/* Offline cache — strategy adapted from dnd-character-sheet's service worker:
   - The DOCUMENT (index.html navigation) is NETWORK-FIRST with a revalidating request; cache is only
     the offline fallback. The service worker, not the app's (possibly broken) JS, owns freshness, so
     a corrupt cached build can't wedge an online user.
   - Everything else (modules, data, css, icons) is PRECACHED at install into a per-deploy cache and
     served cache-first — a version-coherent set of ES modules, no old-module/new-shell skew offline.
   - activate deletes every cache except the current one.
   CACHE is stamped by .githooks/pre-commit on every commit. */
const CACHE = "dnd-crawler-v1.0.8";
const DOC = "./index.html";
const ASSETS = [
  "./",
  "./index.html",
  "./css/app.css",
  "./js/app.js", "./js/ui.js", "./js/icons.js", "./js/state.js", "./js/storage.js", "./js/dice.js",
  "./js/conditions.js", "./js/rules.js", "./js/character.js", "./js/builder.js",
  "./js/sheet.js", "./js/combat.js", "./js/combat-ui.js", "./js/dungeon.js", "./js/audio.js",
  "./data/data.js", "./data/tables.js", "./data/source-data.json",
  "./manifest.webmanifest", "./icon-180.png", "./icon-512.png", "./icon-512-maskable.png",
  // Music (audio/*.mp3) is deliberately NOT precached — ~26 MB total. The fetch handler's
  // cacheFirst picks each track up the first time it plays, so it still works offline afterwards.
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => e.waitUntil(
  caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
));

async function networkFirstDoc(req){
  const cache = await caches.open(CACHE);
  try{
    const net = await fetch(req, { cache: "no-cache" });
    if(net && net.ok){ cache.put(DOC, net.clone()); return net; }
    throw new Error("bad status " + (net && net.status));
  }catch(_){
    return (await cache.match(req)) || (await cache.match(DOC)) ||
      new Response("Offline, and no copy is cached yet. Reconnect once to install it.",
        { status: 503, statusText: "Offline" });
  }
}

async function cacheFirst(req){
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  if(cached) return cached;
  try{
    const net = await fetch(req);
    if(net && net.ok) cache.put(req, net.clone());
    return net;
  }catch(_){
    return new Response("Offline and not cached yet.", { status: 503, statusText: "Offline" });
  }
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if(req.method !== "GET") return;
  const isDoc = req.mode === "navigate" || req.destination === "document" ||
                (req.headers.get("accept") || "").includes("text/html");
  e.respondWith(isDoc ? networkFirstDoc(req) : cacheFirst(req));
});
