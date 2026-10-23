/* Guarda o app no aparelho para abrir sem internet.
   Sempre tenta a rede primeiro: com internet vale a versão publicada; sem internet, a última guardada. */
var CACHE = "teleprompter-v1";
var BASICO = [
  "./", "./index.html", "./video-rdg.js?v=3", "./voz.js?v=1", "./manifest.webmanifest",
  "./icons/icon-180.png", "./icons/icon-192.png", "./icons/icon-512.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(BASICO); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (nomes) {
    return Promise.all(nomes.filter(function (n) { return n !== CACHE; }).map(function (n) { return caches.delete(n); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(fetch(req).then(function (res) {
    if (res.ok) { var copia = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copia); }); }
    return res;
  }).catch(function () {
    return caches.match(req).then(function (r) {
      if (r) return r;
      return req.mode === "navigate" ? caches.match("./index.html") : Response.error();
    });
  }));
});
