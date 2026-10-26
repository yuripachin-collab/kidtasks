'use strict';
/* KidTasks · service worker: кэш приложения для работы без сети.
   Версия в имени кэша: меняем при обновлении файлов — старый кэш удаляется (п.22 ревью). */
const CACHE = 'kidtasks-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './styles/tokens.css',
  './styles/app.css',
  './js/db.js',
  './js/rules.js',
  './js/ops.js',
  './js/app.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request))
  );
});
