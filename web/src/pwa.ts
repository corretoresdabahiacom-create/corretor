import { useEffect, useState } from 'react';

/** Instalação do app (PWA) e aviso de nova versão. */
let deferred: any = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
let updateReady: ServiceWorker | null = null;
let userAskedUpdate = false; // só recarrega quando a pessoa pede (na 1ª instalação o worker assume sem recarregar)

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; emit(); });
  window.addEventListener('appinstalled', () => { deferred = null; emit(); });
}

export const isStandalone = () => typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true);
export const isIOS = () => typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as any).MSStream;

export function usePwa() {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((x) => x + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  return {
    canInstall: !!deferred && !isStandalone(),
    iosHint: isIOS() && !isStandalone(),
    installed: isStandalone(),
    update: !!updateReady,
    install: async () => { if (!deferred) return false; deferred.prompt(); const r = await deferred.userChoice.catch(() => null); deferred = null; emit(); return r?.outcome === 'accepted'; },
    applyUpdate: () => { userAskedUpdate = true; updateReady?.postMessage('skip-waiting'); },
  };
}

export function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      const watch = (w: ServiceWorker | null) => w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) { updateReady = w; emit(); } });
      if (reg.waiting && navigator.serviceWorker.controller) { updateReady = reg.waiting; emit(); }
      reg.addEventListener('updatefound', () => watch(reg.installing));
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    }).catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (userAskedUpdate && !reloaded) { reloaded = true; location.reload(); } });
  });
}
