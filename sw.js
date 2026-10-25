// Offline support: the app's files are cached on first visit, then served from the device.
// When you publish an update, bump VERSION so devices pick up the new files on their next launch.
const VERSION = 'charsheet-v26';
const FILES = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './js/app.js', './js/db.js', './js/model.js', './js/rules.js', './js/sheet.js', './js/theme.js', './js/sync.js', './js/config.js', './js/library.js', './js/autofill.js', './js/libui.js', './js/magic.js', './js/bridge.js', './js/dm.js', './js/options.js', './js/ink.js', './js/tables.js', './js/creatures.js', './js/infuse.js', './data/srd.json',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
  './fonts/alegreya-latin-400-normal.woff2', './fonts/alegreya-latin-400-italic.woff2', './fonts/alegreya-latin-700-normal.woff2', './fonts/alegreya-latin-800-normal.woff2',
  './fonts/alegreya-sans-latin-400-normal.woff2', './fonts/alegreya-sans-latin-500-normal.woff2', './fonts/alegreya-sans-latin-700-normal.woff2',
  './fonts/cinzel-latin-700-normal.woff2', './fonts/im-fell-english-latin-400-normal.woff2', './fonts/uncial-antiqua-latin-400-normal.woff2',
  './fonts/grenze-gotisch-latin-700-normal.woff2', './fonts/eczar-latin-600-normal.woff2',
];

self.addEventListener('install', e => {
  // cache: 'reload' skips the browser's own cache, so an update never picks up stale copies
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('charsheet-') && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Anything not cached at install (the extra fonts) is saved the first time it's used, so it works offline after that
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // only this app's own files: the other apps on this site (magic items, Session Notes) handle theirs
  if (e.request.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return res;
  })));
});
