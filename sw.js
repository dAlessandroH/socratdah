// Service worker: permite instalar la app y abrirla sin conexión (el historial se puede consultar offline;
// generar esquemas o hablar con el tutor necesita internet). Las llamadas a la API nunca se guardan en caché.
const VERSION = "socratdah-v2";

const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./js/main.js",
  "./js/config.js",
  "./js/store.js",
  "./js/ui.js",
  "./js/api.js",
  "./js/markdown.js",
  "./js/voice.js",
  "./js/pomodoro.js",
  "./js/settings.js",
  "./js/esquema.js",
  "./js/tutor.js",
  "./js/history.js",
];

// Archivos versionados del CDN (inmutables). Mermaid se guarda la primera vez que se usa.
const CDN = [
  "https://cdn.jsdelivr.net/npm/marked@18.0.14/lib/marked.umd.js",
  "https://cdn.jsdelivr.net/npm/dompurify@3.4.16/dist/purify.min.js",
];
const CDN_ALLOWED = [...CDN, "https://cdn.jsdelivr.net/npm/mermaid@12.1.0/dist/mermaid.min.js"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(SHELL);
    await Promise.all(CDN.map(async (url) => {
      try {
        const res = await fetch(url, { mode: "cors", credentials: "omit" });
        if (res.ok) await cache.put(url, res);
      } catch {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // CDN versionado: primero caché.
  if (CDN_ALLOWED.includes(url.href)) {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const hit = await cache.match(url.href);
      if (hit) return hit;
      const res = await fetch(request);
      if (res.ok) cache.put(url.href, res.clone());
      return res;
    })());
    return;
  }

  // Archivos propios: primero red (para recibir actualizaciones), caché si no hay conexión.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try {
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
      } catch {
        return (await cache.match(request, { ignoreSearch: true }))
          || (request.mode === "navigate" ? cache.match("./index.html") : Response.error());
      }
    })());
  }
});
