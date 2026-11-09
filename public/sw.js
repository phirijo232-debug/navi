// Static shell only. API responses, uploads, HTML, and JSON are never cached.
const CACHE = 'bmf-static-v1';
const PRECACHE = ['/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

function isStaticAsset(url) {
  return url.origin === self.location.origin && (
    url.pathname === '/manifest.webmanifest' ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.endsWith('.css')
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  let url;
  try { url = new URL(request.url); } catch (err) { return; }
  if (!isStaticAsset(url)) return;
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(request);
    const fresh = fetch(request).then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    }).catch(() => cached);
    return cached || fresh;
  }));
});
