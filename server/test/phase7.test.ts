import { describe, it, expect, beforeAll } from 'vitest';
import sharp from 'sharp';
import { newApp, newOrg, addUser, uniq } from './helpers.js';

let app: any;
beforeAll(async () => { app = await newApp(); });
async function mpUpload(c: any, url: string, file: Buffer, fields: Record<string, string> = {}) {
  const b = '----t' + uniq();
  const parts: Buffer[] = Object.entries(fields).map(([k, v]) => Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: application/octet-stream\r\n\r\n`), file, Buffer.from(`\r\n--${b}--\r\n`));
  const r = await app.inject({ method: 'POST', url, payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${b}`, cookie: c.cookie } });
  let body: any = r.body; try { body = JSON.parse(r.body); } catch { /* */ }
  return { status: r.statusCode, body };
}
const png = (color: string) => sharp({ create: { width: 800, height: 600, channels: 3, background: color } }).png().toBuffer();

describe('Fase 7 — aparência do app', () => {
  it('admin edita; toda a equipe recebe o tema; outra imobiliária não é afetada', async () => {
    const A = await newOrg(app, 'TemaA'); const B = await newOrg(app, 'TemaB');
    const corretor = await addUser(app, A.admin, 'corretor');
    expect((await A.admin.get('/api/auth/me')).body.theme.primary).toBe('#0f766e'); // padrão
    const r = await A.admin.patch('/api/app-theme', { primary: '#1d4ed8', accent: '#f97316', bg: '#0f141a', text: '#eef2f6', font: 'elegante', radius: 'redondo', nav: 'escuro', cards: 'lista', banner: false });
    expect(r.status).toBe(200);
    const t = (await corretor.get('/api/auth/me')).body.theme;
    expect(t).toMatchObject({ primary: '#1d4ed8', bg: '#0f141a', font: 'elegante', nav: 'escuro', cards: 'lista', banner: false });
    expect((await B.admin.get('/api/auth/me')).body.theme.primary).toBe('#0f766e');
    expect((await A.admin.get('/api/auth/me')).body.org.app_theme).toBeUndefined(); // não vaza JSON bruto
    // validações e permissões
    expect((await A.admin.patch('/api/app-theme', { primary: 'blue' })).status).toBe(400);
    expect((await A.admin.patch('/api/app-theme', { nav: 'neon' })).status).toBe(400);
    expect((await corretor.patch('/api/app-theme', { primary: '#000000' })).status).toBe(403);
    expect((await corretor.get('/api/app-theme')).status).toBe(403);
    // foto de capa de outra imobiliária é recusada
    const upB = await mpUpload(B.admin, '/api/site/images', await png('#f00'));
    expect((await A.admin.patch('/api/app-theme', { banner_image: upB.body.id })).status).toBe(400);
    const upA = await mpUpload(A.admin, '/api/site/images', await png('#0f0'));
    expect((await A.admin.patch('/api/app-theme', { banner: true, banner_image: upA.body.id })).status).toBe(200);
    expect((await corretor.get('/api/auth/me')).body.theme.banner_url).toContain(upA.body.id);
    // excluir a foto limpa a capa do app
    await A.admin.del(`/api/site/images/${upA.body.id}`);
    expect((await corretor.get('/api/auth/me')).body.theme.banner_url).toBeNull();
  });

  it('"igual ao site" usa cores, letras e cantos do site e da marca', async () => {
    const { admin } = await newOrg(app, 'TemaSite');
    await admin.patch('/api/brand', { primary: '#7c3aed', secondary: '#22c55e' });
    await admin.patch('/api/site', { theme: { bg: '#f7f2ea', text: '#2b2118', font: 'classica', radius: 'reto', header: 'cor', cards: 'lista' } });
    expect((await admin.patch('/api/app-theme', { source: 'site', primary: '#000000' })).status).toBe(200);
    const t = (await admin.get('/api/auth/me')).body.theme;
    expect(t).toMatchObject({ source: 'site', primary: '#7c3aed', accent: '#22c55e', bg: '#f7f2ea', text: '#2b2118', font: 'classica', radius: 'reto', nav: 'cor', cards: 'lista' });
    // voltar ao próprio mantém o que foi salvo
    await admin.patch('/api/app-theme', { source: 'proprio' });
    expect((await admin.get('/api/auth/me')).body.theme.primary).toBe('#000000');
  });

  it('lista de imóveis traz a foto de capa; miniatura respeita a imobiliária', async () => {
    const A = await newOrg(app, 'ThA'); const B = await newOrg(app, 'ThB');
    const p = (await A.admin.post('/api/properties', { title: 'Casa Thumb ' + uniq(), kind: 'urbano', subtype: 'casa', purposes: ['venda'], price_sale: 1, status: 'disponivel' })).body;
    const f = await mpUpload(A.admin, `/api/properties/${p.id}/files`, await png('#336699'), { category: 'foto', visibility: 'privado' });
    const item = (await A.admin.get('/api/properties?pageSize=50')).body.items.find((x: any) => x.id === p.id);
    expect(item.cover_id).toBe(f.body.id); expect(item.photo_count).toBe(1);
    const th = await app.inject({ method: 'GET', url: `/api/files/${f.body.id}/thumb?w=480`, headers: { cookie: A.admin.cookie } });
    expect(th.statusCode).toBe(200); expect(th.headers['content-type']).toBe('image/webp');
    expect((await app.inject({ method: 'GET', url: `/api/files/${f.body.id}/thumb`, headers: { cookie: B.admin.cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/files/${f.body.id}/thumb` })).statusCode).toBe(401);
  });
});
