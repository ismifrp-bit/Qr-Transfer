// service-worker.js — cache-first app shell so QR Transfer keeps working
// with no network at all after the first successful visit.
'use strict';

const CACHE_VERSION = 'qr-transfer-v1';
const RUNTIME_CACHE = 'qr-transfer-runtime-v1';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './css/responsive.css',
  './js/app.js',
  './js/sender.js',
  './js/receiver.js',
  './js/qr-generator.js',
  './js/qr-scanner.js',
  './js/chunk-manager.js',
  './js/crypto.js',
  './js/compression.js',
  './js/file-handler.js',
  './js/utils.js',
  './workers/transfer-worker.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png'
];

// Third-party libraries — cached at runtime the first time they're
// fetched so the app can go fully offline afterward. See README for how
// to vendor these locally instead if a CDN dependency isn't acceptable.
const THIRD_PARTY = [
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await cache.addAll(APP_SHELL);
    // Best-effort: don't fail install if the CDN is unreachable right now.
    await Promise.all(THIRD_PARTY.map(async (url) => {
      try {
        const res = await fetch(url, { mode: 'cors' });
        if (res.ok) await cache.put(url, res.clone());
      } catch (e) { /* will retry at runtime */ }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(k => k !== CACHE_VERSION && k !== RUNTIME_CACHE)
      .map(k => caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;

    try {
      const fresh = await fetch(req);
      // Cache same-origin app files and the known third-party libs/fonts.
      const isThirdParty = THIRD_PARTY.includes(req.url);
      const isFont = req.url.includes('fonts.googleapis.com') || req.url.includes('fonts.gstatic.com');
      if (fresh.ok && (req.url.startsWith(self.location.origin) || isThirdParty || isFont)) {
        const cache = await caches.open(isThirdParty || isFont ? RUNTIME_CACHE : CACHE_VERSION);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (e) {
      // Offline and not cached — fall back to the shell for navigations.
      if (req.mode === 'navigate') return caches.match('./index.html');
      throw e;
    }
  })());
});
