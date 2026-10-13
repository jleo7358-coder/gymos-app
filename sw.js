// Offline support: every app file is cached on install, so GymOS opens and works with no
// connection at all. A new version is picked up the next time the app is opened online.

const VERSION = "18c49519cea4";
const CACHE = `gymos-app-${VERSION}`;
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/app.css",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./js/app.js",
  "./js/backup.js",
  "./js/db.js",
  "./js/demo.js",
  "./js/engine.js",
  "./js/lzfse.js",
  "./js/nav.js",
  "./js/parser.js",
  "./js/sound.js",
  "./js/ui.js",
  "./js/util.js",
  "./js/views/body.js",
  "./js/views/calendar.js",
  "./js/views/common.js",
  "./js/views/history.js",
  "./js/views/profile.js",
  "./js/views/workout.js"
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('gymos-app-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html') || await cache.match('./');
      if (shell) return shell;
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (e) {
      if (req.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      throw e;
    }
  })());
});
