// Service worker do ImobFlow.
// Guarda só o "casco" do app (HTML, JS, CSS, ícones) para abrir rápido e funcionar como app instalado.
// Nunca guarda dados (/api) nem as páginas públicas (/p e /v), que sempre vêm da rede.
const VERSION = 'v3';
const SHELL = `imobflow-shell-${VERSION}`;
const ASSETS = `imobflow-assets-${VERSION}`;
const PRECACHE = ['/', '/offline.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/favicon.svg'];
const NETWORK_ONLY = [/^\/api\//, /^\/p\//, /^\/v\//, /^\/robots\.txt$/, /^\/sitemap\.xml$/];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE))); });
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keep = [SHELL, ASSETS];
    for (const k of await caches.keys()) if (!keep.includes(k)) await caches.delete(k);
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => {});
    await self.clients.claim();
  })());
});
// O app pede para ativar a nova versão quando o usuário toca em "Atualizar agora".
self.addEventListener('message', (e) => { if (e.data === 'skip-waiting') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request; const u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== location.origin) return;
  if (NETWORK_ONLY.some((r) => r.test(u.pathname))) return; // rede direta, sem cache

  if (req.mode === 'navigate') {
    // Navegação no app: rede primeiro (dados frescos); sem rede, o casco guardado; sem casco, a página offline.
    e.respondWith((async () => {
      try {
        const pre = await e.preloadResponse; if (pre) return pre;
        const r = await fetch(req);
        if (r.ok) { const c = await caches.open(SHELL); c.put('/', r.clone()); }
        return r;
      } catch { return (await caches.match('/')) || (await caches.match('/offline.html')); }
    })());
    return;
  }
  if (u.pathname.startsWith('/assets/')) {
    // Arquivos com hash no nome: nunca mudam, cache primeiro.
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(ASSETS).then((c) => c.put(req, copy)); } return r; })));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
