import { describe, it, expect, beforeAll } from 'vitest';
import { newApp, newOrg, addUser, uniq } from './helpers.js';
import { q } from '../src/db/pool.js';

let app: any;
beforeAll(async () => { app = await newApp(); });

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
async function uploadPhoto(c: any, propId: string, visibility: string) {
  const b = '----x' + uniq();
  const payload = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="category"\r\n\r\nfoto\r\n--${b}\r\nContent-Disposition: form-data; name="visibility"\r\n\r\n${visibility}\r\n--${b}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`), PNG, Buffer.from(`\r\n--${b}--\r\n`)]);
  const r = await app.inject({ method: 'POST', url: `/api/properties/${propId}/files`, payload, headers: { 'content-type': `multipart/form-data; boundary=${b}`, cookie: c.cookie } });
  return JSON.parse(r.body);
}
const mkProp = (c: any, extra: any = {}) => c.post('/api/properties', { title: 'Casa Portal ' + uniq(), kind: 'urbano', subtype: 'casa', purposes: ['venda'], price_sale: 500000, status: 'disponivel', publish_authorized: true, description: 'Linda casa <script>alert(1)</script>', internal_notes: 'SEGREDO-INTERNO', city: 'Cidade', state: 'SP', address: { logradouro: 'Rua Secreta 123' }, show_exact_location: false, ...extra });

async function pageToken(code: string) {
  const html = (await app.inject({ method: 'GET', url: `/p/${code}`, headers: { 'user-agent': 'Mozilla/5.0' } })).body;
  return /,t=("[^"]+"),c=/.exec(html) ? JSON.parse(/,t=("[^"]+"),c=/.exec(html)![1]) : '';
}
const lead = (code: string, token: string, extra: any = {}) => app.inject({ method: 'POST', url: '/api/public/leads', payload: { code, token, name: 'Visitante', phone: '11988887777', consent: true, website: '', ...extra }, headers: { 'content-type': 'application/json' } });

describe('Fase 3 — portal', () => {
  it('publicação respeita autorização, não vaza dados internos e só expõe fotos públicas', async () => {
    const { admin } = await newOrg(app, 'Portal');
    const noAuth = (await mkProp(admin, { publish_authorized: false })).body;
    expect((await admin.post(`/api/properties/${noAuth.id}/publish`)).status).toBe(400);
    const p = (await mkProp(admin)).body;
    const pubPhoto = await uploadPhoto(admin, p.id, 'publico');
    const privPhoto = await uploadPhoto(admin, p.id, 'privado');
    const pb = await admin.post(`/api/properties/${p.id}/publish`);
    expect(pb.status).toBe(200);
    const code = pb.body.code;
    const html = (await app.inject({ method: 'GET', url: `/p/${code}`, headers: { 'user-agent': 'Mozilla/5.0' } }));
    expect(html.statusCode).toBe(200);
    expect(html.body).toContain('og:title');
    expect(html.body).not.toContain('SEGREDO-INTERNO');
    expect(html.body).not.toContain('Rua Secreta');
    expect(html.body).not.toContain('<script>alert(1)</script>'); // escapado
    expect(html.body).toContain(pubPhoto.id);
    expect(html.body).not.toContain(privPhoto.id);
    expect((await app.inject({ method: 'GET', url: `/api/public/files/${pubPhoto.id}` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/public/files/${privPhoto.id}` })).statusCode).toBe(404);
    const j = JSON.parse((await app.inject({ method: 'GET', url: `/api/public/p/${code}` })).body);
    expect(JSON.stringify(j)).not.toContain('internal');
    expect(j.street).toBeNull();
    // preço oculto
    await admin.patch(`/api/properties/${p.id}`, { show_price: false });
    expect(JSON.parse((await app.inject({ method: 'GET', url: `/api/public/p/${code}` })).body).prices).toBeNull();
    // despublicar remove o acesso (e as fotos)
    await admin.post(`/api/properties/${p.id}/unpublish`);
    expect((await app.inject({ method: 'GET', url: `/p/${code}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/public/files/${pubPhoto.id}` })).statusCode).toBe(404);
    // código inválido
    expect((await app.inject({ method: 'GET', url: `/p/abc'--` })).statusCode).toBe(404);
  });

  it('formulário: honeypot, token, validação, duplicidade e conversão em pessoa', async () => {
    const { admin } = await newOrg(app, 'Leads');
    const p = (await mkProp(admin)).body;
    const code = (await admin.post(`/api/properties/${p.id}/publish`)).body.code;
    const token = await pageToken(code);
    expect(token).toContain('.');
    // token recém-emitido: rápido demais (<3 s) => recusado
    expect((await lead(code, token)).statusCode).toBe(400);
    // adianta o relógio do token (assinatura válida, emitida há 10 s)
    const crypto = await import('node:crypto');
    const { config } = await import('../src/lib/config.js');
    const ts = Date.now() - 10000;
    const good = `${ts}.${crypto.createHmac('sha256', config.formSecret).update(`${code}.${ts}`).digest('hex')}`;
    expect((await lead(code, 'forjado.abc')).statusCode).toBe(400);
    expect((await lead(code, good, { consent: false })).statusCode).toBe(400);
    expect((await lead(code, good, { phone: '123' })).statusCode).toBe(400);
    expect((await lead(code, good, { phone: undefined, email: undefined })).statusCode).toBe(400);
    // honeypot: finge sucesso mas não grava
    expect((await lead(code, good, { website: 'http://spam' })).statusCode).toBe(201);
    expect((await admin.get('/api/leads')).body).toHaveLength(0);
    // válido
    expect((await lead(code, good, { message: 'Quero visitar' })).statusCode).toBe(201);
    // duplicado em 24h não cria outro
    expect((await lead(code, good)).statusCode).toBe(201);
    const list = (await admin.get('/api/leads?status=novo')).body;
    expect(list).toHaveLength(1);
    expect(list[0].property_code).toBeTruthy();
    // métricas
    const g = (await admin.get('/api/growth')).body;
    expect(g.last_30_days.leads).toBe(1);
    expect(g.last_30_days.views).toBeGreaterThanOrEqual(1);
    // converter
    const cv = await admin.post(`/api/leads/${list[0].id}/convert`);
    expect(cv.status).toBe(200);
    const person = (await admin.get(`/api/people/${cv.body.person_id}`)).body;
    expect(person.source).toBe('portal');
    expect(person.interactions[0].body).toContain('Quero visitar');
    expect((await admin.post(`/api/leads/${list[0].id}/convert`)).status).toBe(409);
    // outra organização não vê o contato
    const { admin: other } = await newOrg(app, 'Outra');
    expect((await other.get('/api/leads')).body).toEqual([]);
    expect((await other.post(`/api/leads/${list[0].id}/discard`)).status).toBe(404);
    // consulta não converte
    const cons = await addUser(app, admin, 'consulta');
    expect((await cons.post(`/api/leads/${list[0].id}/convert`)).status).toBe(403);
  });

  it('compartilhamento registra canal e exige publicação', async () => {
    const { admin } = await newOrg(app, 'Share');
    const p = (await mkProp(admin)).body;
    expect((await admin.post(`/api/properties/${p.id}/share`, { channel: 'whatsapp' })).status).toBe(400);
    await admin.post(`/api/properties/${p.id}/publish`);
    const s = await admin.post(`/api/properties/${p.id}/share`, { channel: 'whatsapp' });
    expect(s.body.whatsapp_url).toContain('wa.me');
    expect((await admin.get(`/api/properties/${p.id}/portal`)).body.last_30_days.shares).toBe(1);
  });
});

describe('Fase 3 — plano gratuito e indicação', () => {
  it('limita imóveis, usuários e publicações; selo não pode ser removido no gratuito', async () => {
    const { admin } = await newOrg(app, 'Free', 'gratuito');
    const plan = (await admin.get('/api/org/plan')).body;
    expect(plan.plan).toBe('gratuito');
    for (let i = 0; i < 15; i++) expect((await mkProp(admin)).status).toBe(201);
    const over = await mkProp(admin);
    expect(over.status).toBe(402);
    expect(over.body.code).toBe('PLAN_LIMIT');
    // arquivar libera vaga
    const list = (await admin.get('/api/properties?pageSize=5')).body.items;
    await admin.del(`/api/properties/${list[0].id}`);
    expect((await mkProp(admin)).status).toBe(201);
    // publicações
    const ids = (await admin.get('/api/properties?pageSize=10')).body.items.map((x: any) => x.id);
    let ok = 0, blocked = 0;
    for (const id of ids) { const r = await admin.post(`/api/properties/${id}/publish`); if (r.status === 200) ok++; else if (r.status === 402) blocked++; }
    expect(ok).toBe(5); expect(blocked).toBeGreaterThan(0);
    // usuários (admin + 2 convites = 3)
    expect((await admin.post('/api/invites', { email: `a${uniq()}@t.dev`, role: 'corretor' })).status).toBe(201);
    expect((await admin.post('/api/invites', { email: `b${uniq()}@t.dev`, role: 'corretor' })).status).toBe(201);
    expect((await admin.post('/api/invites', { email: `c${uniq()}@t.dev`, role: 'corretor' })).status).toBe(402);
    // selo
    expect((await admin.patch('/api/org/public-profile', { public_badge: false })).status).toBe(402);
    expect((await admin.patch('/api/org/public-profile', { public_name: 'Minha Imob', public_whatsapp: '11 98888-7777' })).status).toBe(200);
    expect((await admin.patch('/api/org/public-profile', { public_whatsapp: '12' })).status).toBe(400);
  });

  it('indicação via ?ref conta imobiliárias indicadas e página mostra o selo', async () => {
    const { admin } = await newOrg(app, 'Indicadora');
    const slug = (await admin.get('/api/org/plan')).body.referral_link.split('ref=')[1];
    const r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { orgName: 'Indicada ' + uniq(), name: 'Novo Dono', email: `n${uniq()}@t.dev`, password: 'senhaSegura123', ref: slug }, headers: { 'content-type': 'application/json' } });
    expect(r.statusCode).toBe(201);
    expect((await admin.get('/api/growth')).body.referred_agencies).toBe(1);
    // ref desconhecido não quebra o cadastro
    const r2 = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { orgName: 'Outra ' + uniq(), name: 'X Y', email: `m${uniq()}@t.dev`, password: 'senhaSegura123', ref: 'nao-existe' }, headers: { 'content-type': 'application/json' } });
    expect(r2.statusCode).toBe(201);
    await q('UPDATE organizations SET plan=$2 WHERE slug=$1', [slug, 'gratuito']);
    const p = (await mkProp(admin)).body;
    const code = (await admin.post(`/api/properties/${p.id}/publish`)).body.code;
    expect((await app.inject({ method: 'GET', url: `/p/${code}` })).body).toContain(`/cadastrar?ref=${slug}`);
  });
});
