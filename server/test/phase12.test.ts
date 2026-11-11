import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { newApp, newOrg, addUser, uniq } from './helpers.js';
import { mapPoint } from '../src/lib/geo.js';

let app: any;
beforeAll(async () => { app = await newApp(); });
afterEach(() => vi.unstubAllGlobals());

const page = async (url: string) => { const r = await app.inject({ method: 'GET', url, headers: { 'user-agent': 'Mozilla/5.0' } }); return { status: r.statusCode, body: r.body as string, headers: r.headers }; };
const slugOf = async (admin: any) => (await admin.get('/api/brand')).body.vitrine_url.split('/v/')[1].replace(/\?.*/, '');
const scriptsCompile = (html: string) => {
  const list = [...html.matchAll(/<script(?![^>]*(?:src=|ld\+json))[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  for (const code of list) expect(() => new Function(code)).not.toThrow();
  return list.length;
};
async function pub(admin: any, extra: any) {
  const p = (await admin.post('/api/properties', { title: 'Imóvel Mapa ' + uniq(), kind: 'urbano', subtype: 'casa', purposes: ['venda'], price_sale: 300000, status: 'disponivel', publish_authorized: true, address: { logradouro: 'Rua Teste', cidade: 'Salvador', uf: 'BA' }, ...extra })).body;
  expect((await admin.post(`/api/properties/${p.id}/publish`)).status).toBe(200);
  return { id: p.id, code: (await admin.get(`/api/properties/${p.id}`)).body.public_code as string };
}

describe('Fase 12 — ponto do mapa e privacidade', () => {
  it('exato mantém 6 casas; sem exato arredonda para ~1 km; inválidos viram null', () => {
    expect(mapPoint({ latitude: -12.971598, longitude: -38.501302, show_exact_location: true })).toEqual({ lat: -12.971598, lng: -38.501302, exact: true });
    expect(mapPoint({ latitude: -12.971598, longitude: -38.501302, show_exact_location: false })).toEqual({ lat: -12.97, lng: -38.5, exact: false });
    expect(mapPoint({ latitude: null, longitude: null })).toBeNull();
    expect(mapPoint({ latitude: 91, longitude: 0 })).toBeNull();
    expect(mapPoint({ latitude: 'abc', longitude: 1 })).toBeNull();
  });
});

describe('Fase 12 — mapa nas páginas públicas', () => {
  it('página do imóvel: ponto exato só se autorizado; senão só a região aproximada (sem vazar o ponto real)', async () => {
    const { admin } = await newOrg(app, 'Mapa'); const slug = await slugOf(admin);
    const exato = await pub(admin, { latitude: -12.971598, longitude: -38.501302, show_exact_location: true });
    const aprox = await pub(admin, { latitude: -13.123456, longitude: -38.654321, show_exact_location: false });
    const sem = await pub(admin, {});
    const e = await page(`/v/${slug}/imovel/${exato.code}`);
    expect(e.body).toContain('id="mp"'); expect(e.body).toContain('-12.971598'); expect(e.body).toContain('/vendor/leaflet.js');
    const a = await page(`/v/${slug}/imovel/${aprox.code}`);
    expect(a.body).toContain('id="mp"'); expect(a.body).toContain('-13.12'); expect(a.body).toContain('Localização aproximada');
    expect(a.body).not.toContain('-13.123456'); expect(a.body).not.toContain('-38.654321');
    expect((await page(`/v/${slug}/imovel/${sem.code}`)).body).not.toContain('id="mp"');
    expect(scriptsCompile(e.body)).toBeGreaterThan(0);
    // a página legada /p não pode expor coordenada de quem não autorizou
    expect((await page(`/p/${aprox.code}`)).body).not.toContain('-13.123456');
  });

  it('vitrine: seção Mapa só aparece com imóveis localizados e nunca mostra coordenadas reais não autorizadas', async () => {
    const { admin } = await newOrg(app, 'MapaV'); const slug = await slugOf(admin);
    await pub(admin, {});
    expect((await page(`/v/${slug}`)).body).not.toContain('id="mapa"');
    const x = await pub(admin, { latitude: -14.866667, longitude: -40.833333, show_exact_location: false });
    const h = (await page(`/v/${slug}`)).body;
    expect(h).toContain('id="mapa"'); expect(h).toContain('/imovel/' + x.code); expect(h).toContain('região aproximada');
    expect(h).not.toContain('-14.866667'); expect(h).not.toContain('-40.833333');
    scriptsCompile(h);
    // seção desligada no editor some
    const site = (await admin.get('/api/site')).body.site;
    const sections = site.sections.map((s: any) => (s.id === 'mapa' ? { ...s, on: false } : s));
    expect((await admin.patch('/api/site', { sections })).status).toBe(200);
    expect((await page(`/v/${slug}?x=1`)).body).not.toContain('id="mapa"');
  });

  it('isolamento: o mapa de uma imobiliária não lista imóveis de outra', async () => {
    const A = await newOrg(app, 'MapaA'); const B = await newOrg(app, 'MapaB');
    const a = await pub(A.admin, { latitude: -10.5, longitude: -37.5, show_exact_location: true });
    await pub(B.admin, { latitude: -9.5, longitude: -36.5, show_exact_location: true });
    const h = (await page(`/v/${await slugOf(B.admin)}`)).body;
    expect(h).not.toContain(a.code); expect(h).not.toContain('-10.5');
  });

  it('serve Leaflet localmente, só os arquivos esperados, e a CSP libera os tiles do OpenStreetMap', async () => {
    const js = await page('/vendor/leaflet.js'); const css = await page('/vendor/leaflet.css');
    expect(js.status).toBe(200); expect(String(js.headers['content-type'])).toContain('javascript'); expect(js.body).toContain('Leaflet');
    expect(css.status).toBe(200); expect(String(css.headers['content-type'])).toContain('text/css');
    for (const bad of ['/vendor/../package.json', '/vendor/package.json', '/vendor/leaflet.js.map', '/vendor/%2e%2e%2fpackage.json']) expect((await page(bad)).status).toBe(404);
    expect(String(js.headers['content-security-policy'])).toContain('https://tile.openstreetmap.org');
  });
});

describe('Fase 12 — localizar pelo endereço', () => {
  it('geocodifica (serviço simulado), usa cache, trata não encontrado e falha do serviço', async () => {
    const { admin } = await newOrg(app, 'Geo');
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init: any) => {
      calls.push(url);
      expect(init.headers['user-agent']).toContain('ImobFlow');
      if (url.includes('inexistente')) return new Response('[]', { status: 200 });
      if (url.includes('falha')) return new Response('x', { status: 503 });
      return new Response(JSON.stringify([{ lat: '-12.9714', lon: '-38.5014', display_name: 'Salvador, Bahia, Brasil' }]), { status: 200 });
    });
    const q1 = `Rua Chile ${uniq()}, Centro, Salvador, BA`;
    const r = await admin.get(`/api/geocode?q=${encodeURIComponent(q1)}`);
    expect(r.status).toBe(200); expect(r.body).toEqual({ lat: -12.9714, lng: -38.5014, label: 'Salvador, Bahia, Brasil' });
    await admin.get(`/api/geocode?q=${encodeURIComponent(q1.toUpperCase())}`);
    expect(calls.length).toBe(1); // segunda consulta veio do cache
    expect((await admin.get('/api/geocode?q=' + encodeURIComponent('rua inexistente 999, nada'))).status).toBe(404);
    expect((await admin.get('/api/geocode?q=' + encodeURIComponent('servico com falha, teste'))).status).toBe(502);
    expect((await admin.get('/api/geocode?q=ab')).status).toBe(400);
  }, 30000);

  it('exige login e permissão de escrita em imóveis', async () => {
    const { admin } = await newOrg(app, 'GeoP');
    const cons = await addUser(app, admin, 'consulta');
    vi.stubGlobal('fetch', async () => { throw new Error('não deveria chamar o serviço'); });
    expect((await cons.get('/api/geocode?q=' + encodeURIComponent('Rua A, 1, Salvador, BA'))).status).toBe(403);
    const anon = await app.inject({ method: 'GET', url: '/api/geocode?q=' + encodeURIComponent('Rua A, 1, Salvador, BA') });
    expect(anon.statusCode).toBe(401);
  });
});
