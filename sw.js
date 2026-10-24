// Offline support: every app file is cached on first visit, then served from the device.
// When you publish an update, bump VERSION so devices pick up the new files on their next launch.
const VERSION = 'charsheet-v1';
const FILES = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './js/app.js', './js/db.js', './js/model.js', './js/rules.js', './js/sheet.js', './js/theme.js', './js/sync.js', './js/config.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
  './fonts/alegreya-latin-400-normal.woff2', './fonts/alegreya-latin-400-italic.woff2', './fonts/alegreya-latin-700-normal.woff2', './fonts/alegreya-latin-800-normal.woff2',
  './fonts/alegreya-sans-latin-400-normal.woff2', './fonts/alegreya-sans-latin-500-normal.woff2', './fonts/alegreya-sans-latin-700-normal.woff2',
  './fonts/cinzel-latin-700-normal.woff2', './fonts/im-fell-english-latin-400-normal.woff2', './fonts/uncial-antiqua-latin-400-normal.woff2',
  './fonts/grenze-gotisch-latin-700-normal.woff2', './fonts/eczar-latin-600-normal.woff2',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request)));
});
