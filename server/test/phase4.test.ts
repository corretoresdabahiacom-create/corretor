import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import { newApp, newOrg, addUser, uniq } from './helpers.js';
import { outbox } from '../src/lib/mailer.js';

let app: any;
beforeAll(async () => { app = await newApp(); });

describe('Fase 4 — agenda por URL (iCalendar)', () => {
  it('feed só com token válido, escopo por usuário, token rotacionável', async () => {
    const { admin } = await newOrg(app, 'Cal');
    const corretor = await addUser(app, admin, 'corretor');
    const start = new Date(Date.now() + 86400000), end = new Date(start.getTime() + 3600000);
    await admin.post('/api/events', { type: 'reuniao', title: 'Reunião; com, vírgula', starts_at: start.toISOString(), ends_at: end.toISOString(), location: 'Rua A' });
    const t1 = (await admin.post('/api/calendar/token')).body.url as string;
    const feed = await app.inject({ method: 'GET', url: t1.replace(/^https?:\/\/[^/]+/, '') });
    expect(feed.statusCode).toBe(200);
    expect(feed.headers['content-type']).toContain('text/calendar');
    expect(feed.body).toContain('BEGIN:VEVENT');
    expect(feed.body).toContain('SUMMARY:Reunião\\; com\\, vírgula');
    expect(feed.body.includes('\r\n')).toBe(true);
    // token inválido / ausente
    expect((await app.inject({ method: 'GET', url: '/api/calendar/feed.ics?token=xxxxxxxxxxxxxxxxxxxxxxxx' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/calendar/feed.ics' })).statusCode).toBe(404);
    // corretor não vê o evento do admin
    const t2 = (await corretor.post('/api/calendar/token')).body.url as string;
    const f2 = await app.inject({ method: 'GET', url: t2.replace(/^https?:\/\/[^/]+/, '') });
    expect(f2.body).not.toContain('BEGIN:VEVENT');
    // rotacionar invalida o anterior
    await admin.post('/api/calendar/token');
    expect((await app.inject({ method: 'GET', url: t1.replace(/^https?:\/\/[^/]+/, '') })).statusCode).toBe(404);
    // revogar
    const t3 = (await admin.post('/api/calendar/token')).body.url as string;
    await admin.del('/api/calendar/token');
    expect((await app.inject({ method: 'GET', url: t3.replace(/^https?:\/\/[^/]+/, '') })).statusCode).toBe(404);
  });
});

describe('Fase 4 — e-mail, SEO e segurança', () => {
  it('envia e-mail de convite e de recuperação sem revelar se a conta existe', async () => {
    const { admin, email } = await newOrg(app, 'Mail');
    outbox.length = 0;
    const to = `conv${uniq()}@t.dev`;
    const inv = await admin.post('/api/invites', { email: to, role: 'corretor' });
    expect(inv.body.emailed).toBe(true);
    expect(outbox.at(-1)!.to).toBe(to);
    expect(outbox.at(-1)!.text).toContain('/convite/');
    outbox.length = 0;
    const r1 = await app.inject({ method: 'POST', url: '/api/auth/forgot', payload: { email }, headers: { 'content-type': 'application/json' } });
    const r2 = await app.inject({ method: 'POST', url: '/api/auth/forgot', payload: { email: `nao${uniq()}@t.dev` }, headers: { 'content-type': 'application/json' } });
    expect(JSON.parse(r1.body).message).toBe(JSON.parse(r2.body).message);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].text).toContain('/redefinir/');
  });

  it('robots.txt e sitemap listam só imóveis publicados e disponíveis', async () => {
    const { admin } = await newOrg(app, 'Seo');
    const mk = async (extra: any = {}) => (await admin.post('/api/properties', { title: 'Seo ' + uniq(), kind: 'urbano', subtype: 'casa', purposes: ['venda'], price_sale: 1, status: 'disponivel', publish_authorized: true, ...extra })).body;
    const a = await mk(); const b = await mk();
    const codeA = (await admin.post(`/api/properties/${a.id}/publish`)).body.code;
    const codeB = (await admin.post(`/api/properties/${b.id}/publish`)).body.code;
    await admin.patch(`/api/properties/${b.id}`, { status: 'vendido' });
    const sm = (await app.inject({ method: 'GET', url: '/sitemap.xml' })).body;
    expect(sm).toContain(`/p/${codeA}`);
    expect(sm).not.toContain(`/p/${codeB}`);
    const rb = (await app.inject({ method: 'GET', url: '/robots.txt' })).body;
    expect(rb).toContain('Disallow: /api/');
    expect(rb).toContain('Sitemap:');
  });

  it('cabeçalhos de segurança e recusa de origem externa', async () => {
    const { admin } = await newOrg(app, 'Sec');
    const h = await app.inject({ method: 'GET', url: '/api/health' });
    expect(String(h.headers['content-security-policy'])).toContain("frame-ancestors 'self'");
    expect(h.headers['x-content-type-options']).toBe('nosniff');
    const bad = await app.inject({ method: 'POST', url: '/api/people', payload: { name: 'X' }, headers: { 'content-type': 'application/json', origin: 'https://evil.example', cookie: admin.cookie } });
    expect(bad.statusCode).toBe(403);
  });
});

describe('Fase 4 — configuração de produção', () => {
  it('recusa configuração insegura', async () => {
    const { config, assertProductionConfig } = await import('../src/lib/config.js');
    const prev = { ...config } as any;
    try {
      (config as any).isProd = true; (config as any).formSecret = ''; (config as any).cookieSecure = false;
      expect(() => assertProductionConfig()).toThrow(/FORM_SECRET/);
      Object.assign(config, { formSecret: 'x'.repeat(32), cookieSecure: true, publicOrigin: 'https://app.exemplo.com.br', devExposeTokens: false, databaseUrl: 'postgres://u:senhaforte@db/x' });
      expect(() => assertProductionConfig()).toThrow(/sslmode/);
      (config as any).databaseUrl = 'postgres://u:senhaforte@db/x?sslmode=require';
      expect(() => assertProductionConfig()).not.toThrow();
    } finally { Object.assign(config, prev); }
  });
});

describe('Fase 4 — PWA', () => {
  it('manifest e service worker existem e o worker nunca guarda /api', () => {
    const m = JSON.parse(fs.readFileSync('../web/public/manifest.webmanifest', 'utf8'));
    expect(m.display).toBe('standalone');
    expect(m.icons.length).toBeGreaterThanOrEqual(2);
    for (const i of m.icons) expect(fs.existsSync('../web/public' + i.src)).toBe(true);
    expect(m.icons.some((i: any) => i.purpose === 'maskable')).toBe(true);
    expect(m.icons.some((i: any) => i.purpose === 'any' && i.sizes === '512x512')).toBe(true);
    // O worker nunca guarda dados nem páginas públicas: testa a lista real de rotas "só rede".
    const sw = fs.readFileSync('../web/public/sw.js', 'utf8');
    const net = new Function(`${sw.match(/const NETWORK_ONLY = [^;]+;/)![0]} return NETWORK_ONLY;`)() as RegExp[];
    for (const path of ['/api/people', '/p/abc123', '/v/minha-imob', '/v/minha-imob/imovel/abc', '/sitemap.xml']) expect(net.some((r) => r.test(path))).toBe(true);
    for (const path of ['/', '/agenda', '/assets/index.js']) expect(net.some((r) => r.test(path))).toBe(false);
    expect(sw).toContain("'/offline.html'");
    expect(fs.existsSync('../web/public/offline.html')).toBe(true);
  });
});
