// Fase 22 — mensagem de WhatsApp, alertas de novos imóveis, favoritos/comparador na vitrine.
import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import { newApp, newOrg, addUser } from './helpers.js';
import { q } from '../src/db/pool.js';
import { config } from '../src/lib/config.js';
import { alertMatches, whatsappMessage } from '../src/lib/engage.js';

let app: any;
beforeAll(async () => { app = await newApp(); });
const slugOf = async (admin: any) => (await admin.get('/api/brand')).body.vitrine_url.split('/v/')[1].replace(/\?.*/, '');
const tok = (slug: string) => { const ts = Date.now() - 10000; return `${ts}.${crypto.createHmac('sha256', config.formSecret).update(`v:${slug}.${ts}`).digest('hex')}`; };
async function publicar(admin: any, extra: any = {}) {
  const p = (await admin.post('/api/properties', { title: 'Casa Azul', kind: 'urbano', subtype: 'casa', purposes: ['venda'], price_sale: 400000, show_price: true, address: { cidade: extra.city ?? 'Campinas', uf: 'SP', bairro: 'Centro' }, bedrooms: 3, status: 'disponivel', ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'city')) })).body;
  await q('UPDATE properties SET publish_authorized=true WHERE id=$1', [p.id]);
  const pub = (await admin.post(`/api/properties/${p.id}/publish`)).body;
  return { id: p.id as string, code: pub.code as string };
}

describe('regras puras', () => {
  const base = { purposes: ['venda'], kind: 'urbano', city: 'Campinas', price_sale: 400000, show_price: true, bedrooms: 3 };
  it('alertMatches respeita cada critério, sem acento/caixa na cidade', () => {
    expect(alertMatches({}, base)).toBe(true);
    expect(alertMatches({ purpose: 'aluguel' }, base)).toBe(false);
    expect(alertMatches({ kind: 'rural' }, base)).toBe(false);
    expect(alertMatches({ city: 'CAMPINAS' }, base)).toBe(true);
    expect(alertMatches({ city: 'Sumaré' }, base)).toBe(false);
    expect(alertMatches({ min_bedrooms: 4 }, base)).toBe(false);
    expect(alertMatches({ purpose: 'venda', max_price: 500000 }, base)).toBe(true);
    expect(alertMatches({ purpose: 'venda', max_price: 300000 }, base)).toBe(false);
    expect(alertMatches({ max_price: 500000 }, { ...base, show_price: false })).toBe(false); // preço oculto não casa com teto
  });
  it('mensagem de WhatsApp: urbano, rural e temporada, sem vazar dados privados', () => {
    const u = whatsappMessage({ ...base, title: 'Casa Azul', neighborhood: 'Centro', state: 'SP', area_total: 120, area_unit: 'm2', purposes: ['venda', 'aluguel'], price_rent: 2000 } as any, 'https://x/v/a/imovel/abc', undefined, 'Imob X');
    expect(u).toContain('*Casa Azul*'); expect(u).toContain('R$'); expect(u).toContain('3 quartos'); expect(u).toContain('https://x/v/a/imovel/abc'); expect(u).toContain('Imob X');
    expect(whatsappMessage({ ...base, title: 'Casa', purposes: ['venda', 'aluguel'], price_rent: 2000 } as any, null, 'aluguel')).toContain('/mês');
    const r = whatsappMessage({ title: 'Sítio', kind: 'rural', purposes: ['arrendamento'], price_lease: 30000, show_price: true, area_total: 10, area_unit: 'alqueire' } as any, null);
    expect(r).toContain('rural'); expect(r).toContain('alqueires'); expect(r).not.toContain('quartos');
    const t = whatsappMessage({ title: 'Praia', kind: 'urbano', purposes: ['temporada'], price_rent: 500, show_price: true, coastal_details: { beach_distance_m: 80, sea_view: true, guests_capacity: 6 } } as any, null);
    expect(t).toContain('A 80 m da praia'); expect(t).toContain('/diária'); expect(t).toContain('6 hóspedes');
    expect(whatsappMessage({ ...base, title: 'X', show_price: false } as any, null)).toContain('sob consulta');
  });
});

describe('mensagem pronta no painel', () => {
  it('traz link só se publicado; exige permissão e isola organização', async () => {
    const { admin } = await newOrg(app, 'WaMsg');
    const draft = (await admin.post('/api/properties', { title: 'Rascunho', kind: 'urbano', subtype: 'casa', purposes: ['venda'], price_sale: 1, status: 'disponivel' })).body.id;
    const r0 = await admin.get(`/api/properties/${draft}/whatsapp-message`);
    expect(r0.status).toBe(200); expect(r0.body.published).toBe(false); expect(r0.body.link).toBeNull(); expect(r0.body.note).toBeTruthy();
    const { id, code } = await publicar(admin);
    const r1 = (await admin.get(`/api/properties/${id}/whatsapp-message?purpose=venda`)).body;
    expect(r1.link).toContain(`/imovel/${code}`); expect(r1.text).toContain(r1.link);
    const { admin: outro } = await newOrg(app, 'WaMsgOutro');
    expect((await outro.get(`/api/properties/${id}/whatsapp-message`)).status).toBe(404);
  });
});

describe('alertas de novos imóveis', () => {
  it('formulário público: token, honeypot, consentimento, contato; duplicado não repete', async () => {
    const { admin } = await newOrg(app, 'Alert'); const slug = await slugOf(admin);
    await publicar(admin);
    const page = (await app.inject({ method: 'GET', url: `/v/${slug}`, headers: { 'user-agent': 'Mozilla/5.0' } })).body;
    expect(page).toContain('id="nf"'); expect(page).toContain('Receba avisos');
    const post = (extra: any = {}, tk = tok(slug)) => app.inject({ method: 'POST', url: `/api/public/vitrine/${slug}/alertas`, headers: { 'content-type': 'application/json' }, payload: { token: tk, name: 'Carlos Lima', phone: '19988887777', purpose: 'venda', city: 'Campinas', consent: true, website: '', ...extra } });
    expect((await post({}, 'forjado.xx')).statusCode).toBe(400);
    expect((await post({ consent: false })).statusCode).toBe(400);
    expect((await post({ phone: undefined })).statusCode).toBe(400);
    expect((await post({ purpose: 'nave' })).statusCode).toBe(400);
    expect((await post({ website: 'spam' })).statusCode).toBe(201);
    expect((await admin.get('/api/property-alerts')).body).toHaveLength(0);
    expect((await post({})).statusCode).toBe(201);
    expect((await post({})).statusCode).toBe(201);
    expect((await admin.get('/api/property-alerts')).body).toHaveLength(1);
  });
  it('só avisa de imóvel publicado depois do pedido, que combine; "avisado" zera; pausa e exclusão', async () => {
    const { admin } = await newOrg(app, 'Alert2'); const slug = await slugOf(admin);
    await publicar(admin, { title: 'Antigo' }); // publicado antes do pedido: não conta
    await app.inject({ method: 'POST', url: `/api/public/vitrine/${slug}/alertas`, headers: { 'content-type': 'application/json' }, payload: { token: tok(slug), name: 'Carlos Lima', phone: '19988887777', purpose: 'venda', city: 'Campinas', max_price: 500000, consent: true, website: '' } });
    let a = (await admin.get('/api/property-alerts')).body[0];
    expect(a.new_matches).toHaveLength(0); expect(a.ip_hash).toBeUndefined();
    await q(`UPDATE properties SET published_at = now() - interval '2 hours' WHERE title='Antigo' AND org_id=(SELECT org_id FROM property_alerts WHERE id=$1)`, [a.id]);
    await q(`UPDATE property_alerts SET created_at = now() - interval '1 hour' WHERE id=$1`, [a.id]);
    await publicar(admin, { title: 'Combina' });
    await publicar(admin, { title: 'Caro', price_sale: 900000 });
    await publicar(admin, { title: 'Outra cidade', city: 'Sumaré' });
    a = (await admin.get('/api/property-alerts')).body[0];
    expect(a.new_matches.map((m: any) => m.title)).toEqual(['Combina']);
    expect(a.new_matches[0].text).toContain('Carlos'); expect(a.new_matches[0].link).toContain(`/v/${slug}/imovel/`);
    expect((await admin.post(`/api/property-alerts/${a.id}/notified`)).status).toBe(200);
    expect((await admin.get('/api/property-alerts')).body[0].new_matches).toHaveLength(0);
    await admin.patch(`/api/property-alerts/${a.id}`, { status: 'pausado' });
    expect((await admin.get('/api/property-alerts')).body[0].status).toBe('pausado');
    expect((await admin.del(`/api/property-alerts/${a.id}`)).status).toBe(200);
    expect((await admin.get('/api/property-alerts')).body).toHaveLength(0);
  });
  it('isola por organização e exige permissão', async () => {
    const { admin } = await newOrg(app, 'Alert3'); const slug = await slugOf(admin); await publicar(admin);
    await app.inject({ method: 'POST', url: `/api/public/vitrine/${slug}/alertas`, headers: { 'content-type': 'application/json' }, payload: { token: tok(slug), name: 'Ana Souza', email: 'ana@x.com', consent: true, website: '' } });
    const a = (await admin.get('/api/property-alerts')).body[0];
    const { admin: outro } = await newOrg(app, 'Alert3Outro');
    expect((await outro.get('/api/property-alerts')).body).toHaveLength(0);
    expect((await outro.del(`/api/property-alerts/${a.id}`)).status).toBe(404);
    expect((await outro.post(`/api/property-alerts/${a.id}/notified`)).status).toBe(404);
    const consulta = await addUser(app, admin, 'consulta');
    expect((await consulta.del(`/api/property-alerts/${a.id}`)).status).toBe(403);
  });
});

describe('favoritos e comparador na vitrine', () => {
  it('páginas listam só imóveis publicados desta vitrine e escapam entrada', async () => {
    const { admin } = await newOrg(app, 'Fav'); const slug = await slugOf(admin);
    const a = await publicar(admin, { title: 'Casa A' }); const b = await publicar(admin, { title: 'Casa B', price_sale: 500000 });
    const { admin: outro } = await newOrg(app, 'FavOutro'); const o = await publicar(outro, { title: 'Alheia' });
    const get = (u: string) => app.inject({ method: 'GET', url: u, headers: { 'user-agent': 'Mozilla/5.0' } });
    const home = (await get(`/v/${slug}`)).body; const cmp0 = (await get(`/v/${slug}/comparar?c=${a.code},${b.code}`)).body;
    for (const html of [home, (await get(`/v/${slug}/imovel/${a.code}`)).body, cmp0]) for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) expect(() => new Function(m[1])).not.toThrow(); // JS inline sem erro de sintaxe
    expect(home).toContain(`data-code="${a.code}"`); expect(home).toContain('id="ebar"');
    const cmp = await get(`/v/${slug}/comparar?c=${a.code},${b.code},${o.code}`);
    expect(cmp.statusCode).toBe(200); expect(cmp.body).toContain('Casa A'); expect(cmp.body).toContain('Casa B'); expect(cmp.body).not.toContain('Alheia'); expect(cmp.headers['x-robots-tag']).toBe('noindex');
    expect((await get(`/v/${slug}/comparar?c=${a.code}`)).body).toContain('pelo menos 2');
    const fav = (await get(`/v/${slug}/favoritos?c=${b.code},<script>x</script>,${o.code}`)).body;
    expect(fav).toContain('Casa B'); expect(fav).not.toContain('Alheia'); expect(fav).not.toContain('<script>x');
    expect((await get(`/v/${slug}/favoritos`)).body).toContain('Nenhum favorito');
    expect((await get('/v/nao-existe-xyz/favoritos')).statusCode).toBe(404);
    const prop = (await get(`/v/${slug}/imovel/${a.code}`)).body;
    expect(prop).toContain(`data-fav="${a.code}"`); expect(prop).toContain('wa.me/?text=');
  });
});

describe('LGPD dos pedidos de aviso', () => {
  it('exporta e apaga junto com a pessoa (mesmo telefone)', async () => {
    const { admin } = await newOrg(app, 'AlertLgpd'); const slug = await slugOf(admin); await publicar(admin);
    await app.inject({ method: 'POST', url: `/api/public/vitrine/${slug}/alertas`, headers: { 'content-type': 'application/json' }, payload: { token: tok(slug), name: 'Rita Alves', phone: '19977776666', consent: true, website: '' } });
    const pe = (await admin.post('/api/people', { kind: 'fisica', name: 'Rita Alves', phones: ['19977776666'], emails: [], roles: ['comprador'] })).body;
    const ex = (await admin.get(`/api/people/${pe.id}/export`)).body;
    expect(JSON.stringify(ex)).toContain('pedidos_de_aviso'); expect(ex.dados?.pedidos_de_aviso ?? ex.pedidos_de_aviso).toHaveLength(1);
    expect((await admin.get('/api/property-alerts')).body).toHaveLength(1);
    const er = await admin.post(`/api/people/${pe.id}/anonymize`, { confirm: 'ANONIMIZAR' });
    expect(er.status).toBe(200);
    expect((await admin.get('/api/property-alerts')).body).toHaveLength(0);
  });
});
