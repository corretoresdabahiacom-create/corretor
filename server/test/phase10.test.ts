import { describe, it, expect, beforeAll } from 'vitest';
import { newApp, newOrg, uniq } from './helpers.js';
import { q1 } from '../src/db/pool.js';

let app: any;
beforeAll(async () => { app = await newApp(); });

const page = async (url: string) => { const r = await app.inject({ method: 'GET', url, headers: { 'user-agent': 'Mozilla/5.0' } }); return { status: r.statusCode, body: r.body as string, headers: r.headers }; };
const slugOf = async (admin: any) => (await admin.get('/api/brand')).body.vitrine_url.split('/v/')[1].replace(/\?.*/, '');
const iso = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const lead = (code: string, token: string, extra: any = {}) => app.inject({ method: 'POST', url: '/api/public/leads', payload: { code, token, name: 'Maria Visitante', phone: '71988887777', consent: true, website: '', ...extra }, headers: { 'content-type': 'application/json' } });

async function publicado(admin: any) {
  const p = (await admin.post('/api/properties', { title: 'Casa Visita ' + uniq(), kind: 'urbano', subtype: 'casa', purposes: ['venda'], price_sale: 350000, status: 'disponivel', publish_authorized: true, city: 'Salvador', state: 'BA' })).body;
  await admin.post(`/api/properties/${p.id}/publish`);
  const code = (await admin.get(`/api/properties/${p.id}`)).body.public_code;
  const slug = await slugOf(admin);
  const html = (await page(`/v/${slug}/imovel/${code}`)).body;
  const token = /id="lf"[^>]*data-token="([^"]+)"/.exec(html)?.[1] ?? /data-token="([^"]+)"[^>]*id="lf"/.exec(html)?.[1] ?? '';
  await new Promise((res) => setTimeout(res, 3100)); // o formulário recusa envio em menos de 3 s (anti-robô)
  return { code, slug, token, html };
}

describe('Fase 10 — pedido de visita pela página pública', () => {
  it('formulário mostra data/período e a visita chega ao corretor', async () => {
    const { admin } = await newOrg(app, 'Visita');
    const { code, token, html } = await publicado(admin);
    expect(token.length).toBeGreaterThan(10);
    expect(html).toContain('name="visit_date"'); expect(html).toContain('name="visit_period"');
    const d = iso(5);
    const r = await lead(code, token, { visit_date: d, visit_period: 'tarde' });
    expect(r.statusCode).toBe(201);
    const leads = (await admin.get('/api/leads?status=novo')).body;
    const l = leads.find((x: any) => x.name === 'Maria Visitante');
    expect(l.details.visit).toEqual({ date: d, period: 'tarde' });
  });

  it('recusa datas inválidas, passadas, longe demais e período desconhecido', async () => {
    const { admin } = await newOrg(app, 'VisitaB');
    const { code, token } = await publicado(admin);
    for (const extra of [{ visit_date: iso(-10) }, { visit_date: iso(200) }, { visit_date: '2026-02-31' }, { visit_date: 'amanha' }, { visit_date: iso(3), visit_period: 'madrugada' }])
      expect((await lead(code, token, { ...extra, phone: '7199' + Math.floor(1000000 + Math.random() * 8999999) })).statusCode).toBe(400);
  });

  it('visita sem data continua funcionando como contato comum', async () => {
    const { admin } = await newOrg(app, 'VisitaC');
    const { code, token } = await publicado(admin);
    expect((await lead(code, token)).statusCode).toBe(201);
    const l = (await admin.get('/api/leads?status=novo')).body[0];
    expect(l.details).toEqual({});
  });
});

describe('Fase 10 — salvar contato (vCard)', () => {
  it('404 sem dados de contato; com dados baixa um .vcf válido e com caracteres escapados', async () => {
    const { admin } = await newOrg(app, 'Vcf');
    const slug = await slugOf(admin);
    expect((await page(`/v/${slug}/contato.vcf`)).status).toBe(404);
    expect((await admin.patch('/api/site', { contact: { phone: '(71) 3333-4444', email: 'contato@exemplo.com', address: 'Rua A, 10; Centro' } })).status).toBe(200);
    const r = await page(`/v/${slug}/contato.vcf`);
    expect(r.status).toBe(200);
    expect(String(r.headers['content-type'])).toContain('text/vcard');
    expect(String(r.headers['content-disposition'])).toContain(`${slug}.vcf`);
    for (const t of ['BEGIN:VCARD', 'VERSION:3.0', 'TEL;TYPE=WORK,VOICE:7133334444', 'EMAIL;TYPE=INTERNET:contato@exemplo.com', 'ADR;TYPE=WORK:;;Rua A' + String.fromCharCode(92) + ', 10' + String.fromCharCode(92) + '; Centro', 'END:VCARD']) expect(r.body).toContain(t);
    expect(r.body).toContain('\r\n');
    expect((await page(`/v/${slug}`)).body).toContain(`/v/${slug}/contato.vcf`);
  });

  it('não vaza dados entre imobiliárias e slug inválido dá 404', async () => {
    const A = await newOrg(app, 'VcfA'); const B = await newOrg(app, 'VcfB');
    await A.admin.patch('/api/site', { contact: { phone: '(71) 90000-1111', email: 'a@exemplo.com' } });
    const slugB = await slugOf(B.admin);
    expect((await page(`/v/${slugB}/contato.vcf`)).status).toBe(404); // B não tem contato; nada de A aparece
    expect((await page('/v/../contato.vcf')).status).toBe(404);
    expect(await q1('SELECT 1')).toBeTruthy();
  });
});
