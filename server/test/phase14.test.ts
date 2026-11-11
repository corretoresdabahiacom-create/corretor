import { describe, it, expect, beforeAll } from 'vitest';
import { newApp, newOrg, addUser, uniq } from './helpers.js';
import { config } from '../src/lib/config.js';
import { parseRange } from '../src/lib/media.js';
import { sniffVideo } from '../src/lib/storage.js';

config.maxVideoBytes = 64 * 1024; config.maxOrgVideoBytes = 150 * 1024; // limites pequenos só para testar
let app: any;
beforeAll(async () => { app = await newApp(); });

const mp4 = (n = 20000) => { const b = Buffer.alloc(n, 0x41); b.writeUInt32BE(24, 0); b.write('ftypisom', 4, 'ascii'); return b; };
const webm = (n = 5000) => { const b = Buffer.alloc(n, 0x42); b[0] = 0x1a; b[1] = 0x45; b[2] = 0xdf; b[3] = 0xa3; return b; };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);

async function up(c: any, url: string, file: Buffer, fields: Record<string, string>) {
  const b = '----v' + uniq();
  const parts: Buffer[] = Object.entries(fields).map(([k, v]) => Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="clipe.mp4"\r\nContent-Type: video/mp4\r\n\r\n`), file, Buffer.from(`\r\n--${b}--\r\n`));
  const r = await app.inject({ method: 'POST', url, payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${b}`, cookie: c.cookie } });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : {} };
}
const get = (url: string, headers: any = {}) => app.inject({ method: 'GET', url, headers: { 'user-agent': 'Mozilla/5.0', ...headers } });
const slugOf = async (admin: any) => (await admin.get('/api/brand')).body.vitrine_url.split('/v/')[1].replace(/\?.*/, '');
async function imovel(admin: any, publish = true) {
  const p = (await admin.post('/api/properties', { title: 'Casa Vídeo ' + uniq(), kind: 'urbano', subtype: 'casa', purposes: ['venda'], price_sale: 300000, status: 'disponivel', publish_authorized: true })).body;
  if (publish) expect((await admin.post(`/api/properties/${p.id}/publish`)).status).toBe(200);
  return { id: p.id, code: publish ? (await admin.get(`/api/properties/${p.id}`)).body.public_code : '' };
}

describe('Fase 14 — leitura de Range e tipo do vídeo', () => {
  it('parseRange cobre intervalo, aberto, sufixo e inválidos', () => {
    expect(parseRange(undefined, 1000)).toBeNull();
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=0-99999', 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange('bytes=0-', 10 * 1024 * 1024)).toEqual({ start: 0, end: 2 * 1024 * 1024 - 1 }); // resposta parcial limitada
    for (const bad of ['bytes=1000-', 'bytes=5-2', 'bytes=0-1,5-9', 'pages=0-1', 'bytes=-', 'bytes=-0', 'bytes=a-b']) expect(parseRange(bad, 1000)).toBe('invalid');
  });
  it('sniffVideo reconhece MP4 (marcas comuns) e WebM, recusa o resto', () => {
    expect(sniffVideo(mp4())).toBe('video/mp4'); expect(sniffVideo(webm())).toBe('video/webm');
    expect(sniffVideo(PNG)).toBeNull(); expect(sniffVideo(Buffer.from('%PDF-1.4 xxxxxxxxxxxxxx'))).toBeNull();
    const mov = mp4(); mov.write('ftypqt  ', 4, 'ascii'); expect(sniffVideo(mov)).toBeNull();
  });
});

describe('Fase 14 — envio de vídeo', () => {
  it('aceita MP4/WebM, recusa outros tipos, vídeo no lugar de foto e arquivos grandes', async () => {
    const { admin } = await newOrg(app, 'Vid'); const p = await imovel(admin);
    const u = `/api/properties/${p.id}/files`;
    const ok = await up(admin, u, mp4(), { category: 'video' });
    expect(ok.status).toBe(201); expect(ok.body.category).toBe('video'); expect(ok.body.mime).toBe('video/mp4'); expect(ok.body.visibility).toBe('privado');
    expect((await up(admin, u, webm(), { category: 'video' })).body.mime).toBe('video/webm');
    expect((await up(admin, u, PNG, { category: 'video' })).status).toBe(415);
    expect((await up(admin, u, mp4(), { category: 'foto' })).status).toBe(415); // vídeo não vira foto
    expect((await up(admin, u, mp4(70 * 1024), { category: 'video' })).status).toBe(413);
    expect((await up(admin, `/api/people/${(await admin.post('/api/people', { kind: 'fisica', name: 'X', phones: [], emails: [], roles: [] })).body.id}/files`, mp4(), { category: 'video' })).status).toBe(400);
    // foto continua limitada ao teto de arquivos comuns (10 MB), documento não aceita vídeo
    expect((await up(admin, u, mp4(), { category: 'documento' })).status).toBe(415);
  });

  it('limita 3 vídeos por imóvel e o total por imobiliária; excluir libera espaço', async () => {
    const { admin } = await newOrg(app, 'VidLim'); const a = await imovel(admin, false); const b = await imovel(admin, false);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) { const r = await up(admin, `/api/properties/${a.id}/files`, mp4(30000 + i), { category: 'video' }); expect(r.status).toBe(201); ids.push(r.body.id); }
    expect((await up(admin, `/api/properties/${a.id}/files`, mp4(), { category: 'video' })).status).toBe(409); // 3 por imóvel
    // teto da imobiliária 150 KiB: já há ~90 KB; mais 64 KB passa do teto
    const big = await up(admin, `/api/properties/${b.id}/files`, mp4(64000), { category: 'video' });
    expect(big.status).toBe(409); expect(big.body.error).toContain('imobiliária');
    expect((await admin.del(`/api/files/${ids[0]}`)).status).toBe(200);
    expect((await up(admin, `/api/properties/${b.id}/files`, mp4(64000), { category: 'video' })).status).toBe(201);
  });

  it('permissões: consulta não envia; outra imobiliária não vê; o limite de uma não consome o da outra', async () => {
    const A = await newOrg(app, 'VidA'); const B = await newOrg(app, 'VidB'); const p = await imovel(A.admin, false);
    const cons = await addUser(app, A.admin, 'consulta');
    expect((await up(cons, `/api/properties/${p.id}/files`, mp4(), { category: 'video' })).status).toBe(403);
    const v = await up(A.admin, `/api/properties/${p.id}/files`, mp4(), { category: 'video' });
    expect((await get(`/api/files/${v.body.id}/download`, { cookie: B.admin.cookie })).statusCode).toBe(404);
    expect((await get(`/api/files/${v.body.id}/download`)).statusCode).toBe(401);
    expect((await get(`/api/files/${v.body.id}/download`, { cookie: cons.cookie })).statusCode).toBe(200); // consulta pode ver
    const pb = await imovel(B.admin, false);
    expect((await up(B.admin, `/api/properties/${pb.id}/files`, mp4(60000), { category: 'video' })).status).toBe(201);
  });
});

describe('Fase 14 — entrega com Range e página pública', () => {
  it('vídeo privado não é público; público + publicado toca, com Range 206/416 e conteúdo correto', async () => {
    const { admin } = await newOrg(app, 'VidPub'); const p = await imovel(admin); const slug = await slugOf(admin);
    const file = mp4(30000);
    const v = (await up(admin, `/api/properties/${p.id}/files`, file, { category: 'video', caption: 'Tour pela casa' })).body;
    expect((await get(`/api/public/video/${v.id}`)).statusCode).toBe(404); // privado
    expect((await get(`/v/${slug}/imovel/${p.code}`)).body).not.toContain('/api/public/video/');
    expect((await admin.patch(`/api/files/${v.id}`, { visibility: 'publico' })).status).toBe(200);

    const full = await get(`/api/public/video/${v.id}`);
    expect(full.statusCode).toBe(200); expect(full.headers['content-type']).toBe('video/mp4'); expect(full.headers['accept-ranges']).toBe('bytes');
    expect(Buffer.from(full.rawPayload).equals(file)).toBe(true);
    const r1 = await get(`/api/public/video/${v.id}`, { range: 'bytes=0-9' });
    expect(r1.statusCode).toBe(206); expect(r1.headers['content-range']).toBe('bytes 0-9/30000'); expect(Buffer.from(r1.rawPayload).equals(file.subarray(0, 10))).toBe(true);
    const r2 = await get(`/api/public/video/${v.id}`, { range: 'bytes=29990-' });
    expect(r2.statusCode).toBe(206); expect(Buffer.from(r2.rawPayload).equals(file.subarray(29990))).toBe(true);
    const r3 = await get(`/api/public/video/${v.id}`, { range: 'bytes=-5' });
    expect(Buffer.from(r3.rawPayload).equals(file.subarray(29995))).toBe(true);
    const bad = await get(`/api/public/video/${v.id}`, { range: 'bytes=40000-' });
    expect(bad.statusCode).toBe(416); expect(bad.headers['content-range']).toBe('bytes */30000');
    // também para quem está logado no app
    expect((await get(`/api/files/${v.id}/download`, { cookie: admin.cookie, range: 'bytes=0-3' })).statusCode).toBe(206);

    const html = (await get(`/v/${slug}/imovel/${p.code}`)).body;
    expect(html).toContain('<video'); expect(html).toContain(`/api/public/video/${v.id}`); expect(html).toContain('type="video/mp4"'); expect(html).toContain('Tour pela casa');
    // despublicar o imóvel tira o vídeo do ar
    expect((await admin.post(`/api/properties/${p.id}/unpublish`)).status).toBe(200);
    expect((await get(`/api/public/video/${v.id}`)).statusCode).toBe(404);
  });

  it('vídeo de outra imobiliária não aparece na página e id inválido dá 404', async () => {
    const A = await newOrg(app, 'VidIsoA'); const B = await newOrg(app, 'VidIsoB');
    const pa = await imovel(A.admin); const va = (await up(A.admin, `/api/properties/${pa.id}/files`, mp4(), { category: 'video' })).body;
    await A.admin.patch(`/api/files/${va.id}`, { visibility: 'publico' });
    const pb = await imovel(B.admin);
    expect((await get(`/v/${await slugOf(B.admin)}/imovel/${pb.code}`)).body).not.toContain(va.id);
    expect((await get('/api/public/video/nao-e-uuid')).statusCode).toBe(404);
    expect((await B.admin.patch(`/api/files/${va.id}`, { visibility: 'privado' })).status).toBe(404);
    expect((await B.admin.del(`/api/files/${va.id}`)).status).toBe(404);
  });
});
