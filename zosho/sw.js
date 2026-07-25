/**
 * 画面の読み込みを速くし、通信が不安定でも起動できるようにするためのキャッシュ。
 *
 * 扱うのは同一オリジンの GET だけ。
 * データのやり取り（GASへのPOST）には一切触れない＝古いデータを返す事故が起きない。
 */
'use strict';

const CACHE = 'zosho-shell-v1';
const SHELL = [
  './',
  './index.html',
  './api.js',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()) // 一部が取れなくても起動は妨げない
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  // 新しい版をすぐ反映したいので通信優先。失敗した時だけキャッシュを使う。
  event.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(cache => cache.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
