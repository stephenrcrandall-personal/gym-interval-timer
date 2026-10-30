// Offline support for the Home Screen app. Network first, so a new version is picked up the next
// time the app opens with a connection; the saved copy is only used when there's no connection.
// Spotify calls are never cached.
const CACHE = 'git-v1';
const SHELL = ['./', 'index.html', 'app.css', 'config.js', 'manifest.webmanifest',
  'js/app.js', 'js/schedule.js', 'js/store.js', 'js/spotify.js', 'js/music.js', 'js/cues.js', 'js/run.js',
  'voice/get-ready.wav', 'voice/work.wav', 'voice/rest.wav', 'voice/halfway.wav', 'voice/last-one.wav',
  'icons/icon-192.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;   // Spotify, fonts: straight to the network
  e.respondWith((async () => {
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok) { const c = await caches.open(CACHE); c.put(req, res.clone()); }
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') { const page = await caches.match('index.html'); if (page) return page; }
      throw err;
    }
  })());
});
