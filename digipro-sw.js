/* DigiPro service worker — scope is the /digipro/ folder only.
   HTML: network-first (updates show up fast), falls back to cache offline.
   Other files in this folder: cache-first with background refresh.
   Google Fonts: cached at runtime so the LCD font works offline. */
const CACHE = 'digipro-v1';
const FONT_CACHE = 'digipro-fonts-v1';
const CORE = [
  './',
  'index.html',
  'digipro.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png',
  'favicon-32.png'
];
const SCOPE_URL = self.registration.scope;
const SCOPE_PATH = new URL(SCOPE_URL).pathname;
const INDEX_URL = new URL('index.html', SCOPE_URL).href;

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CORE.map(u => new Request(u, { cache: 'reload' }))))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // Only touch DigiPro's own caches: Cache Storage is shared by the whole origin,
    // so other apps on easylandx.github.io must never be cleaned up from here.
    const keep = [CACHE, FONT_CACHE];
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith('digipro-') && !keep.includes(n)).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

async function networkFirstPage(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await withTimeout(fetch(req, { cache: 'no-cache' }), 4000);
    if (res && res.ok) {
      cache.put(INDEX_URL, res.clone());
      cache.put(SCOPE_URL, res.clone());
    }
    return res;
  } catch (err) {
    return (await cache.match(req, { ignoreSearch: true })) ||
           (await cache.match(SCOPE_URL)) ||
           (await cache.match(INDEX_URL)) ||
           Response.error();
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const refresh = fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  return cached || (await refresh) || Response.error();
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts (stylesheet + font files)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(staleWhileRevalidate(req, FONT_CACHE));
    return;
  }

  // Anything else must be same-origin AND inside /digipro/
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE_PATH)) return;

  if (req.mode === 'navigate' || req.destination === 'document') {
    e.respondWith(networkFirstPage(req));
    return;
  }
  e.respondWith(staleWhileRevalidate(req, CACHE));
});
