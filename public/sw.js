/* ============================================================
   sw.js — Service Worker
   · 本地资源：cache-first
   · CDN 资源：stale-while-revalidate
   · 激活时清理旧版本缓存
   ============================================================ */
'use strict';

const VERSION = 'text-editor-v36';
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
    }).then(function () {
      return self.clients.claim();
    }).then(function () {
      // 通知所有已控制的客户端：SW 已升级。客户端收到后用 sessionStorage
      // 去重，对当前会话首次收到的 VERSION 自动 reload 一次加载新版 CSS/JS。
      return self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    }).then(function (clients) {
      clients.forEach(function (c) {
        try { c.postMessage({ type: 'SW_UPDATED', version: VERSION }); } catch (e) {}
      });
    })
  );
});

self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);

  // sw.js 自身走 network-first：这是必须例外 —— 否则 sw.js 也走 cache-first 会导致
  // 浏览器永远拿不到新版 sw.js（已装 PWA 的页面里 sw.js 永远命中本地缓存），
  // 永不能更新到新版，新 CSS/JS 也再进不到 cache。一旦 sw.js 自身能网络优先，
  // 浏览器就能检测到更新 → install 新版 SW → 新 SW 接管后 fetch 其他资源（新 cache miss）→
  // 落到 network 抓最新 CSS/JS → 真正生效。
  if (url.pathname === '/sw.js' || url.pathname.endsWith('/sw.js')) {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var clone = res.clone();
          caches.open(LOCAL_CACHE).then(function (c) { c.put(req, clone); });
        }
        return res;
      }).catch(function () { return caches.match(req); })
    );
    return;
  }

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