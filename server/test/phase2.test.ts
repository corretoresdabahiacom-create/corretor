import { describe, it, expect, beforeAll } from 'vitest';
import { newApp, newOrg, addUser, CPF_OK, CPF_OK_2 } from './helpers.js';

let app: any;
beforeAll(async () => { app = await newApp(); });

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const PDF = Buffer.from('%PDF-1.4\n%fake test pdf\n');

function multipart(file: Buffer, filename: string, fields: Record<string, string> = {}) {
  const b = '----t' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`), file, Buffer.from(`\r\n--${b}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
}
async function up(c: any, url: string, file: Buffer, name: string, fields: Record<string, string> = {}) {
  const m = multipart(file, name, fields);
  const r = await app.inject({ method: 'POST', url, payload: m.payload, headers: { ...m.headers, cookie: c.cookie } });
  let body: any = r.body; try { body = JSON.parse(r.body); } catch { /* */ }
  return { status: r.statusCode, body };
}
async function dl(c: any, url: string) { const r = await app.inject({ method: 'GET', url, headers: { cookie: c.cookie } }); return r; }

async function seed(admin: any) {
  const prop = (await admin.post('/api/properties', { title: 'Sítio Teste Rural', kind: 'rural', subtype: 'sitio', purposes: ['arrendamento'], price_lease: 5000, area_total: 10, area_unit: 'ha', status: 'disponivel' })).body;
  const urb = (await admin.post('/api/properties', { title: 'Casa Teste Urbana', kind: 'urbano', subtype: 'casa', purposes: ['aluguel'], price_rent: 2000, status: 'disponivel' })).body;
  const a = (await admin.post('/api/people', { kind: 'fisica', name: 'Dono Teste', document: CPF_OK, phones: [], emails: [], roles: ['proprietario'] })).body;
  const b = (await admin.post('/api/people', { kind: 'fisica', name: 'Arrendatario Teste', document: CPF_OK_2, phones: [], emails: [], roles: ['locatario'] })).body;
  return { prop, urb, a, b };
}

describe('Fase 2 — arquivos', () => {
  it('upload valida tipo real, tamanho, permissões e isolamento', async () => {
    const { admin } = await newOrg(app, 'Arq');
    const { prop, a } = await seed(admin);
    const ok = await up(admin, `/api/properties/${prop.id}/files`, PNG, '../../etc/passwd.png', { category: 'foto' });
    expect(ok.status).toBe(201);
    expect(ok.body.is_cover).toBe(true);
    expect(ok.body.filename).not.toContain('/');
    // arquivo disfarçado (texto com extensão .jpg) é recusado
    expect((await up(admin, `/api/properties/${prop.id}/files`, Buffer.from('<script>alert(1)</script>'), 'x.jpg', { category: 'foto' })).status).toBe(415);
    // PDF não é foto
    expect((await up(admin, `/api/properties/${prop.id}/files`, PDF, 'x.pdf', { category: 'foto' })).status).toBe(415);
    // documento é sempre privado, mesmo se pedirem público
    const doc = await up(admin, `/api/properties/${prop.id}/files`, PDF, 'matricula.pdf', { category: 'documento', doc_type: 'matricula', visibility: 'publico' });
    expect(doc.status).toBe(201);
    expect(doc.body.visibility).toBe('privado');
    const d = await dl(admin, doc.body.url);
    expect(d.statusCode).toBe(200);
    expect(d.headers['content-type']).toBe('application/pdf');
    expect(String(d.headers['content-disposition'])).toContain('attachment');
    // consulta vê fotos mas não documentos
    const viewer = await addUser(app, admin, 'consulta');
    expect((await viewer.get(`/api/properties/${prop.id}/files`)).body.map((f: any) => f.category)).toEqual(['foto']);
    expect((await dl(viewer, doc.body.url)).statusCode).toBe(403);
    expect((await dl(viewer, ok.body.url)).statusCode).toBe(200);
    expect((await up(viewer, `/api/properties/${prop.id}/files`, PNG, 'a.png', { category: 'foto' })).status).toBe(403);
    // assistente: pode fotos, não documentos de pessoa
    const asst = await addUser(app, admin, 'assistente');
    expect((await up(asst, `/api/properties/${prop.id}/files`, PNG, 'b.png', { category: 'foto' })).status).toBe(201);
    expect((await up(asst, `/api/people/${a.id}/files`, PDF, 'rg.pdf', { category: 'documento', doc_type: 'identidade' })).status).toBe(403);
    expect((await up(admin, `/api/people/${a.id}/files`, PDF, 'rg.pdf', { category: 'documento', doc_type: 'identidade' })).status).toBe(201);
    // outra organização não enxerga
    const { admin: other } = await newOrg(app, 'Outra');
    expect((await dl(other, doc.body.url)).statusCode).toBe(404);
    expect((await up(other, `/api/properties/${prop.id}/files`, PNG, 'z.png', { category: 'foto' })).status).toBe(404);
    expect((await other.del(`/api/files/${ok.body.id}`)).status).toBe(404);
  });

  it('capa, legenda, exclusão e limite de tamanho', async () => {
    const { admin } = await newOrg(app, 'Capa');
    const { prop } = await seed(admin);
    const f1 = (await up(admin, `/api/properties/${prop.id}/files`, PNG, '1.png', { category: 'foto' })).body;
    const f2 = (await up(admin, `/api/properties/${prop.id}/files`, PNG, '2.png', { category: 'foto' })).body;
    expect(f2.is_cover).toBe(false);
    await admin.patch(`/api/files/${f2.id}`, { is_cover: true, caption: 'Fachada' });
    const list = (await admin.get(`/api/properties/${prop.id}/files`)).body;
    expect(list.filter((x: any) => x.is_cover).map((x: any) => x.id)).toEqual([f2.id]);
    await admin.del(`/api/files/${f2.id}`);
    expect((await admin.get(`/api/properties/${prop.id}/files`)).body.find((x: any) => x.is_cover).id).toBe(f1.id);
    const big = Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024)]);
    expect((await up(admin, `/api/properties/${prop.id}/files`, big, 'big.png', { category: 'foto' })).status).toBe(413);
  });
});

describe('Fase 2 — contratos', () => {
  it('ciclo de vida, sobreposição, status do imóvel e alertas', async () => {
    const { admin } = await newOrg(app, 'Ctr');
    const { prop, urb, a, b } = await seed(admin);
    const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    const base = { kind: 'arrendamento', property_id: prop.id, owner_person_id: a.id, counterparty_person_id: b.id, start_date: day(-300), end_date: day(20), value_amount: 3000, value_period: 'mensal', adjustment_index: 'IGP-M', adjustment_month: (new Date().getUTCMonth() + 2) % 12 || 12, rural_area_ha: 8 };
    // validações
    expect((await admin.post('/api/contracts', { ...base, end_date: day(-400) })).status).toBe(400);
    expect((await admin.post('/api/contracts', { ...base, counterparty_person_id: a.id })).status).toBe(400);
    expect((await admin.post('/api/contracts', { ...base, property_id: urb.id })).status).toBe(400); // arrendamento exige rural
    const c = await admin.post('/api/contracts', base);
    expect(c.status).toBe(201);
    expect(c.body.status).toBe('rascunho');
    const act = await admin.post(`/api/contracts/${c.body.id}/activate`);
    expect(act.status).toBe(200);
    expect((await admin.get(`/api/properties/${prop.id}`)).body.status).toBe('arrendado');
    // sobreposição
    const c2 = (await admin.post('/api/contracts', { ...base, start_date: day(0), end_date: day(100) })).body;
    expect((await admin.post(`/api/contracts/${c2.id}/activate`)).status).toBe(409);
    // alertas
    const al = (await admin.get('/api/contracts/alerts')).body;
    expect(al.some((x: any) => x.type === 'vencimento' && x.severity === 'alta')).toBe(true);
    // permissão
    const asst = await addUser(app, admin, 'assistente');
    expect((await asst.get('/api/contracts')).status).toBe(200);
    expect((await asst.post('/api/contracts', base)).status).toBe(403);
    const cons = await addUser(app, admin, 'consulta');
    expect((await cons.get('/api/contracts')).status).toBe(403);
    // isolamento
    const { admin: other } = await newOrg(app, 'Out');
    expect((await other.get(`/api/contracts/${c.body.id}`)).status).toBe(404);
    expect((await other.get('/api/contracts')).body).toEqual([]);
    // encerrar
    expect((await admin.post(`/api/contracts/${c.body.id}/close`, { status: 'encerrado' })).status).toBe(400); // motivo obrigatório
    expect((await admin.post(`/api/contracts/${c.body.id}/close`, { status: 'encerrado', reason: 'Fim do prazo' })).status).toBe(200);
    expect((await admin.get(`/api/properties/${prop.id}`)).body.status).toBe('disponivel');
    expect((await admin.patch(`/api/contracts/${c.body.id}`, { notes: 'x' })).status).toBe(409);
  });
});
