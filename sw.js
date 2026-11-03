// Offline support: the app page is network-first (so updates show up), everything else is cache-first.
const C = "notepad-v55", APP = "./Scratchpad%20for%20phone.html";
self.addEventListener("install", e => { e.waitUntil(caches.open(C).then(c => c.addAll([APP, "./src/themes.js", "./editor.js", "./manifest.webmanifest", "./assets/icon.svg", "./assets/icon-maskable.svg"])).then(() => self.skipWaiting())) });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())) });
self.addEventListener("fetch", e => {
  const r = e.request; if (r.method !== "GET") return;
  if (r.mode === "navigate") return e.respondWith(fetch(r).then(res => { const cp = res.clone(); caches.open(C).then(c => c.put(APP, cp)); return res }).catch(() => caches.match(APP)));
  e.respondWith(caches.match(r).then(hit => hit || fetch(r).then(res => { if (res.ok || res.type === "opaque") { const cp = res.clone(); caches.open(C).then(c => c.put(r, cp)) } return res })));
});
