import { config } from './config.js';

export type MapPoint = { lat: number; lng: number; exact: boolean };
const num = (v: any) => (v === null || v === undefined || v === '' ? NaN : Number(v));

/** Ponto para o mapa PÚBLICO. Sem "mostrar localização exata", arredonda para uma grade de ~1 km (a página desenha uma área, nunca o endereço). */
export function mapPoint(p: { latitude?: any; longitude?: any; show_exact_location?: boolean }): MapPoint | null {
  const lat = num(p.latitude), lng = num(p.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (p.show_exact_location) return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, exact: true };
  return { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100, exact: false };
}

// Geocodificação via Nominatim (OpenStreetMap, gratuito). Política de uso: identificar o app e no máximo 1 consulta por segundo.
const cache = new Map<string, { lat: number; lng: number; label: string } | null>();
let last = 0; let chain: Promise<unknown> = Promise.resolve();

export function geocode(query: string): Promise<{ lat: number; lng: number; label: string } | null> {
  const key = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (cache.has(key)) return Promise.resolve(cache.get(key)!);
  const run = async () => {
    const wait = last + 1100 - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&q=${encodeURIComponent(key)}`;
    const res = await fetch(url, { headers: { 'user-agent': `${config.appName}/0.1 (${config.publicOrigin})`, accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`geocoder ${res.status}`);
    const j = (await res.json()) as any[];
    const hit = j[0] ? { lat: Number(j[0].lat), lng: Number(j[0].lon), label: String(j[0].display_name ?? '') } : null;
    const ok = hit && Number.isFinite(hit.lat) && Number.isFinite(hit.lng) ? hit : null;
    if (cache.size > 300) cache.delete(cache.keys().next().value!);
    cache.set(key, ok);
    return ok;
  };
  const p = chain.then(run, run) as Promise<{ lat: number; lng: number; label: string } | null>;
  chain = p.catch(() => undefined);
  return p;
}
