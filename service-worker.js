/* Backrooms Runner PWA cache. Bump CACHE_VERSION when publishing future updates. */
const CACHE_VERSION = 'backrooms-runner-v14';
const APP_CACHE = `${CACHE_VERSION}-app`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const APP_SHELL = [
  "./README.md",
  "./assets/level0-carpet.png",
  "./assets/level0-ceiling.png",
  "./assets/level0-wallpaper.png",
  "./assets/level1-ceiling.jpg",
  "./assets/level1-floor.jpg",
  "./assets/level1-wall.jpg",
  "./assets/level2-block.jpg",
  "./assets/level2-concrete.jpg",
  "./assets/level2-floor.jpg",
  "./assets/level2-pipe.jpg",
  "./assets/level2-rust.jpg",
  "./assets/menu-wallpaper-v3.png",
  "./css/entities/smiler.css",
  "./css/levels/level0.css",
  "./css/levels/level1.css",
  "./css/main.css",
  "./css/systems/auth.css",
  "./css/systems/menu.css",
  "./css/systems/transitions.css",
  "./css/systems/tutorial.css",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./index.html",
  "./js/core.js",
  "./js/entities/beast.js",
  "./js/entities/hound.js",
  "./js/entities/smiler.js",
  "./js/game.js",
  "./js/levels/level0.js",
  "./js/levels/level1.js",
  "./js/levels/level2.js",
  "./js/levels/level3.js",
  "./js/levels/level4.js",
  "./js/levels/level5.js",
  "./js/levels/level6.js",
  "./js/systems/atmosphere.js",
  "./js/systems/auth.js",
  "./js/systems/dev-commands.js",
  "./js/systems/keyboard-guide.js",
  "./js/systems/menu.js",
  "./js/systems/noise-architectural.js",
  "./js/systems/passc.js",
  "./js/systems/player.js",
  "./js/systems/sanity.js",
  "./js/systems/seed.js",
  "./js/systems/tutorial.js",
  "./js/world/assets.js",
  "./manifest.json",
  "./ts/systems/seed.ts",
  "./tsconfig.json"
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    // A single missing optional asset should not prevent the app shell from installing.
    await Promise.all(APP_SHELL.map(async (path) => {
      try { await cache.add(new Request(new URL(path, self.registration.scope), { cache: 'reload' })); }
      catch (error) { console.warn('Could not pre-cache', path, error); }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([APP_CACHE, RUNTIME_CACHE]);
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('backrooms-runner-') && !keep.has(key)).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const isAppOrigin = url.origin === self.location.origin;
  const isNavigation = request.mode === 'navigate';

  if (isNavigation && isAppOrigin) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(APP_CACHE);
        cache.put(request, fresh.clone()).catch(() => {});
        return fresh;
      } catch (_) {
        const cache = await caches.open(APP_CACHE);
        return (await cache.match(request)) || (await cache.match(new URL('./index.html', self.registration.scope).href));
      }
    })());
    return;
  }

  // The game's own code (JS/CSS/HTML) is network-first, so an update is never half old, half new.
  // The cache is only the offline fallback. Images, fonts and external scripts stay cache-first below.
  const isCode = isAppOrigin && (request.destination === 'script' || request.destination === 'style' || /\.(?:js|css|html|json)$/.test(url.pathname));
  if (isCode) {
    event.respondWith((async () => {
      const cache = await caches.open(APP_CACHE);
      try {
        const fresh = await fetch(request, { cache: 'no-cache' });
        if (fresh && fresh.ok) cache.put(request, fresh.clone()).catch(() => {});
        return fresh;
      } catch (error) {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw error;
      }
    })());
    return;
  }

  // Cache local game files and external script dependencies after they load once.
  if (isAppOrigin || request.destination === 'script' || request.destination === 'style' || request.destination === 'image' || request.destination === 'font') {
    event.respondWith((async () => {
      const cache = await caches.open(isAppOrigin ? APP_CACHE : RUNTIME_CACHE);
      const cached = await cache.match(request);
      if (cached) {
        // Refresh in the background so future launches can pick up updates.
        fetch(request).then((response) => {
          if (response && (response.ok || response.type === 'opaque')) cache.put(request, response).catch(() => {});
        }).catch(() => {});
        return cached;
      }
      try {
        const response = await fetch(request);
        if (response && (response.ok || response.type === 'opaque')) cache.put(request, response.clone()).catch(() => {});
        return response;
      } catch (error) {
        if (cached) return cached;
        throw error;
      }
    })());
  }
});
