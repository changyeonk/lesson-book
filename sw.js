// 인터넷이 없어도 열리도록 앱 파일을 보관한다. 파일을 고치면 CACHE 번호를 올린다.
const CACHE = 'lessonbook-5';
const FILES = ['./', 'index.html', 'logic.js', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png'];

self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))));
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
));
// 새 버전을 먼저 받아 보고, 인터넷이 없으면 보관본을 쓴다.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && new URL(e.request.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
