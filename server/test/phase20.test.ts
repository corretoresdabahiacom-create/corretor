// Fase 20 — reordenar fotos do imóvel.
import { describe, it, expect, beforeAll } from 'vitest';
import { newApp, newOrg, addUser, uniq } from './helpers.js';

let app: any;
beforeAll(async () => { app = await newApp(); });
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
async function photo(c: any, propId: string, name: string) {
  const b = '----x' + uniq();
  const payload = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="category"\r\n\r\nfoto\r\n--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}.png"\r\nContent-Type: image/png\r\n\r\n`), PNG, Buffer.from(`\r\n--${b}--\r\n`)]);
  const r = await app.inject({ method: 'POST', url: `/api/properties/${propId}/files`, payload, headers: { 'content-type': `multipart/form-data; boundary=${b}`, cookie: c.cookie } });
  return JSON.parse(r.body).id as string;
}
const prop = async (c: any) => (await c.post('/api/properties', { title: 'Casa ' + uniq(), kind: 'urbano', subtype: 'casa', purposes: ['venda'], price_sale: 1, status: 'disponivel' })).body.id as string;
const order = async (c: any, p: string) => (await c.get(`/api/properties/${p}/files`)).body.filter((f: any) => f.category === 'foto').map((f: any) => f.id);

describe('reordenar fotos', () => {
  it('muda a ordem, mantém as não citadas no fim e recusa foto alheia ou repetida', async () => {
    const { admin } = await newOrg(app, 'Ord'); const p = await prop(admin);
    const [a, b, c] = [await photo(admin, p, 'a'), await photo(admin, p, 'b'), await photo(admin, p, 'c')];
    expect(await order(admin, p)).toEqual([a, b, c]);
    expect((await admin.put(`/api/properties/${p}/files/order`, { ids: [c, a, b] })).status).toBe(200);
    expect(await order(admin, p)).toEqual([c, a, b]);
    expect((await admin.put(`/api/properties/${p}/files/order`, { ids: [b] })).status).toBe(200);
    expect(await order(admin, p)).toEqual([b, c, a]);
    expect((await admin.put(`/api/properties/${p}/files/order`, { ids: [a, a] })).status).toBe(400);
    const p2 = await prop(admin); const x = await photo(admin, p2, 'x');
    expect((await admin.put(`/api/properties/${p}/files/order`, { ids: [x, a] })).status).toBe(400);
    expect((await admin.put(`/api/properties/${p}/files/order`, { ids: ['nao-e-uuid'] })).status).toBe(400);
    expect(await order(admin, p)).toEqual([b, c, a]);
  });
  it('exige permissão e respeita a imobiliária', async () => {
    const { admin } = await newOrg(app, 'OrdPerm'); const p = await prop(admin); const a = await photo(admin, p, 'a');
    const consulta = await addUser(app, admin, 'consulta');
    expect((await consulta.put(`/api/properties/${p}/files/order`, { ids: [a] })).status).toBe(403);
    const { admin: outro } = await newOrg(app, 'OrdOutro');
    expect((await outro.put(`/api/properties/${p}/files/order`, { ids: [a] })).status).toBe(404);
  });
});
