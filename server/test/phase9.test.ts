import { describe, it, expect, beforeAll } from 'vitest';
import { config } from '../src/lib/config.js';
import { storage } from '../src/lib/storage.js';
import { q, q1 } from '../src/db/pool.js';
import { newApp, newOrg, uniq } from './helpers.js';

// Antes de qualquer uso do storage neste arquivo: arquivos vão para o Postgres (como na hospedagem gratuita).
config.storageDriver = 'db';
let app: any;
beforeAll(async () => { app = await newApp(); });

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
async function upload(c: any, propId: string, visibility: string) {
  const b = '----y' + uniq();
  const payload = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="category"\r\n\r\nfoto\r\n--${b}\r\nContent-Disposition: form-data; name="visibility"\r\n\r\n${visibility}\r\n--${b}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`), PNG, Buffer.from(`\r\n--${b}--\r\n`)]);
  const r = await app.inject({ method: 'POST', url: `/api/properties/${propId}/files`, payload, headers: { 'content-type': `multipart/form-data; boundary=${b}`, cookie: c.cookie } });
  return { status: r.statusCode, body: JSON.parse(r.body) };
}
const mkProp = (c: any) => c.post('/api/properties', { title: 'Casa DB ' + uniq(), kind: 'urbano', subtype: 'casa', purposes: ['venda'], price_sale: 400000, status: 'disponivel', publish_authorized: true, city: 'Salvador', state: 'BA' });

describe('Fase 9 — arquivos no Postgres (STORAGE_DRIVER=db)', () => {
  it('envia, baixa e apaga; só o dono da imobiliária acessa', async () => {
    const A = await newOrg(app, 'BlobA'); const B = await newOrg(app, 'BlobB');
    const p = (await mkProp(A.admin)).body;
    const up = await upload(A.admin, p.id, 'privado');
    expect(up.status).toBe(201);
    const key = (await q1<any>('SELECT storage_key FROM files WHERE id=$1', [up.body.id])).storage_key as string;
    const row = await q1<any>('SELECT size, mime FROM blobs WHERE key=$1', [key]);
    expect(row.size).toBe(PNG.length); expect(row.mime).toBe('image/png');
    const dl = await app.inject({ method: 'GET', url: `/api/files/${up.body.id}/download`, headers: { cookie: A.admin.cookie } });
    expect(dl.statusCode).toBe(200); expect(Buffer.from(dl.rawPayload).equals(PNG)).toBe(true);
    expect((await app.inject({ method: 'GET', url: `/api/files/${up.body.id}/download`, headers: { cookie: B.admin.cookie } })).statusCode).toBe(404);
    expect((await A.admin.del(`/api/files/${up.body.id}`)).status).toBeLessThan(300);
    expect(await q1('SELECT 1 FROM blobs WHERE key=$1', [key])).toBeNull();
  });

  it('chave inválida é recusada e excluir a conta apaga os arquivos em cascata', async () => {
    await expect(storage().get('../../etc/passwd')).rejects.toThrow('chave inválida');
    await expect(storage().put('x/y', PNG, 'image/png')).rejects.toThrow('chave inválida');
    const A = await newOrg(app, 'BlobC');
    const p = (await mkProp(A.admin)).body;
    await upload(A.admin, p.id, 'publico');
    const org = await q1<any>('SELECT org_id FROM users WHERE email=$1', [A.email]);
    expect((await q('SELECT 1 FROM blobs WHERE org_id=$1', [org.org_id])).length).toBe(1);
    expect((await A.admin.post('/api/auth/account/delete', { password: 'senhaSegura123', confirm: 'EXCLUIR' })).status).toBe(200);
    expect((await q('SELECT 1 FROM blobs WHERE org_id=$1', [org.org_id])).length).toBe(0);
  });
});
