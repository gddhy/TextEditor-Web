/* ============================================================
   sw.js — Service Worker
   · 本地资源：cache-first
   · CDN 资源：stale-while-revalidate
   · 激活时清理旧版本缓存
   ============================================================ */
'use strict';

const VERSION = 'text-editor-v7';
const LOCAL_CACHE = VERSION + '-local';
const CDN_CACHE = VERSION + '-cdn';

const LOCAL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './css/diff.css',
  './js/config.js',
  './js/loader.js',
  './js/encoding.js',
  './js/langs.js',
  './js/markdown.js',
  './js/ui.js',
  './js/files.js',
  './js/watch.js',
  './js/editor.js',
  './js/app.js',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-256.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(LOCAL_CACHE).then(function (cache) {
      return Promise.all(LOCAL_ASSETS.map(function (u) {
        return fetch(u, { credentials: 'omit' })
          .then(function (res) { return cache.put(u, res); })
          .catch(function (err) { console.warn('[SW] 预缓存失败:', u, err); });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k.indexOf(VERSION) !== 0;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin === self.location.origin) {
    e.respondWith(cacheFirst(req, LOCAL_CACHE));
  } else if (isCdnHost(url)) {
    e.respondWith(staleWhileRevalidate(req, CDN_CACHE));
  }
});

function cacheFirst(req, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(req, { ignoreVary: true }).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (res) {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(function () {
        // 离线且无缓存时，导航回退到 index.html（SPA 行为）
        if (req.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 504, statusText: 'Offline' });
      });
    });
  });
}

function staleWhileRevalidate(req, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    var pending = fetch(req).then(function (res) {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    }).catch(function () {
      // 网络失败时返回缓存
      return cache.match(req, { ignoreVary: true });
    });
    return cache.match(req, { ignoreVary: true }).then(function (cached) {
      return cached || pending;
    });
  });
}

function isCdnHost(url) {
  var h = url.hostname;
  return /npmmirror|bootcdn|staticfile|bytecdntp|jsdelivr|jsd\.onmicrosoft|unpkg|cdnjs|jsdelivr\.net|tencent\.com|alicdn|qpic|gtimg/i.test(h);
}