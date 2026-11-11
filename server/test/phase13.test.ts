import { describe, it, expect, beforeAll } from 'vitest';
import { newApp, newOrg, addUser, uniq, CPF_OK, CPF_OK_2 } from './helpers.js';
import { q, q1 } from '../src/db/pool.js';

let app: any;
beforeAll(async () => { app = await newApp(); });

const PDF = Buffer.from('%PDF-1.4\n%teste lgpd\n');
async function upFile(c: any, url: string) {
  const b = '----p' + uniq();
  const payload = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="category"\r\n\r\ndocumento\r\n--${b}\r\nContent-Disposition: form-data; name="doc_type"\r\n\r\nidentidade\r\n--${b}\r\nContent-Disposition: form-data; name="file"; filename="rg.pdf"\r\nContent-Type: application/octet-stream\r\n\r\n`), PDF, Buffer.from(`\r\n--${b}--\r\n`)]);
  const r = await app.inject({ method: 'POST', url, payload, headers: { 'content-type': `multipart/form-data; boundary=${b}`, cookie: c.cookie } });
  return r.statusCode;
}
const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function titular(admin: any) {
  const email = `titular-${uniq()}@exemplo.com`, phone = '71' + String(900000000 + Math.floor(Math.random() * 99999999));
  const p = (await admin.post('/api/people', { kind: 'fisica', name: 'Maria Titular', document: CPF_OK, phones: [phone], emails: [email], roles: ['locatario'], private_notes: 'Gosta de casa com quintal', source: 'indicação' })).body;
  await admin.post(`/api/people/${p.id}/interactions`, { type: 'ligacao', body: 'Falamos sobre o aluguel' });
  const prop = (await admin.post('/api/properties', { title: 'Casa do Titular', kind: 'urbano', subtype: 'casa', purposes: ['venda', 'aluguel'], price_sale: 400000, price_rent: 2000, status: 'disponivel', publish_authorized: true })).body;
  await admin.post('/api/deals', { person_id: p.id, property_ids: [prop.id], purpose: 'venda', estimated_value: 400000 });
  expect(await upFile(admin, `/api/people/${p.id}/files`)).toBe(201);
  const org = (await q1<any>('SELECT org_id FROM users WHERE email=$1', [(await admin.get('/api/auth/me')).body.user.email])).org_id;
  await q(`INSERT INTO portal_leads(org_id,property_id,name,phone,email,message,consent_text) SELECT $1,id,'Maria Site',$2,$3,'quero visitar','ok' FROM properties WHERE org_id=$1 LIMIT 1`, [org, phone, email]);
  return { p, prop, email, phone, org };
}

describe('Fase 13 — exportar dados do titular', () => {
  it('reúne pessoa, interações, negócios, arquivos (sem a chave interna) e contatos do site', async () => {
    const { admin } = await newOrg(app, 'Lgpd'); const t = await titular(admin);
    const r = await admin.get(`/api/people/${t.p.id}/export`);
    expect(r.status).toBe(200);
    expect(String(r.headers['content-disposition'])).toContain('attachment'); expect(r.headers['cache-control']).toBe('no-store');
    const j = r.body;
    expect(j.pessoa.name).toBe('Maria Titular'); expect(j.pessoa.document).toBe(CPF_OK); expect(j.pessoa.private_notes).toContain('quintal'); expect(j.pessoa.org_id).toBeUndefined();
    expect(j.interacoes.length).toBe(1); expect(j.negocios.length).toBe(1); expect(j.arquivos.length).toBe(1);
    expect(JSON.stringify(j.arquivos)).not.toContain('storage_key');
    expect(j.contatos_do_site.length).toBe(1); expect(j.contatos_do_site[0].message).toBe('quero visitar'); expect(JSON.stringify(j)).not.toContain('ip_hash');
    expect((await q1<any>(`SELECT 1 FROM audit_log WHERE org_id=$1 AND action='person.export'`, [t.org]))).toBeTruthy();
  });

  it('só quem tem permissão de exportar; outra imobiliária não enxerga', async () => {
    const A = await newOrg(app, 'LgpdA'); const B = await newOrg(app, 'LgpdB'); const t = await titular(A.admin);
    expect((await B.admin.get(`/api/people/${t.p.id}/export`)).status).toBe(404);
    expect((await (await addUser(app, A.admin, 'corretor')).get(`/api/people/${t.p.id}/export`)).status).toBe(403);
    expect((await (await addUser(app, A.admin, 'assistente')).get(`/api/people/${t.p.id}/export`)).status).toBe(403);
    expect((await (await addUser(app, A.admin, 'gestor')).get(`/api/people/${t.p.id}/export`)).status).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/people/${t.p.id}/export` })).statusCode).toBe(401);
  });
});

describe('Fase 13 — anonimizar', () => {
  it('exige confirmação e perfil de administrador', async () => {
    const A = await newOrg(app, 'AnonA'); const t = await titular(A.admin);
    expect((await A.admin.post(`/api/people/${t.p.id}/anonymize`, { confirm: 'talvez' })).status).toBe(400);
    expect((await (await addUser(app, A.admin, 'gestor')).post(`/api/people/${t.p.id}/anonymize`, { confirm: 'ANONIMIZAR' })).status).toBe(403);
    expect((await A.admin.get(`/api/people/${t.p.id}`)).body.name).toBe('Maria Titular'); // nada foi apagado
    const B = await newOrg(app, 'AnonB');
    expect((await B.admin.post(`/api/people/${t.p.id}/anonymize`, { confirm: 'ANONIMIZAR' })).status).toBe(404);
  });

  it('remove identificação, interações, arquivos e contatos do site; mantém o negócio sem identificar', async () => {
    const { admin } = await newOrg(app, 'AnonC'); const t = await titular(admin);
    const key = (await q1<any>('SELECT storage_key FROM files WHERE person_id=$1', [t.p.id])).storage_key;
    const r = await admin.post(`/api/people/${t.p.id}/anonymize`, { confirm: 'anonimizar' });
    expect(r.status).toBe(200); expect(r.body.arquivos_apagados).toBe(1); expect(r.body.contatos_do_site_apagados).toBe(1); expect(r.body.avisos.length).toBeGreaterThan(0);
    const row = await q1<any>('SELECT * FROM people WHERE id=$1', [t.p.id]);
    expect(row.name).toBe('Titular anonimizado'); expect(row.document).toBeNull(); expect(row.document_norm).toBeNull();
    expect(row.phones).toEqual([]); expect(row.emails).toEqual([]); expect(row.private_notes).toBeNull(); expect(row.archived_at).not.toBeNull();
    expect((await q('SELECT 1 FROM person_interactions WHERE person_id=$1', [t.p.id])).length).toBe(0);
    expect((await q('SELECT 1 FROM files WHERE person_id=$1', [t.p.id])).length).toBe(0);
    expect((await q('SELECT 1 FROM portal_leads WHERE org_id=$1', [t.org])).length).toBe(0);
    expect((await q('SELECT 1 FROM deals WHERE person_id=$1', [t.p.id])).length).toBe(1);
    const audit = await q1<any>(`SELECT detail FROM audit_log WHERE org_id=$1 AND action='person.anonymize'`, [t.org]);
    expect(JSON.stringify(audit.detail)).not.toContain('Maria'); expect(JSON.stringify(audit.detail)).not.toContain(CPF_OK);
    // o documento anonimizado já pode ser reutilizado em outro cadastro
    expect((await admin.post('/api/people', { kind: 'fisica', name: 'Outra Pessoa', document: CPF_OK, phones: [], emails: [], roles: [] })).status).toBe(201);
    void key;
  });

  it('bloqueia quando há contrato ativo', async () => {
    const { admin } = await newOrg(app, 'AnonD'); const t = await titular(admin);
    const dono = (await admin.post('/api/people', { kind: 'fisica', name: 'Dono', document: CPF_OK_2, phones: [], emails: [], roles: ['proprietario'] })).body;
    const c = (await admin.post('/api/contracts', { kind: 'locacao', property_id: t.prop.id, owner_person_id: dono.id, counterparty_person_id: t.p.id, start_date: day(-10), end_date: day(355), value_amount: 2000, due_day: 5 })).body;
    expect((await admin.post(`/api/contracts/${c.id}/activate`)).status).toBe(200);
    const r = await admin.post(`/api/people/${t.p.id}/anonymize`, { confirm: 'ANONIMIZAR' });
    expect(r.status).toBe(409); expect(r.body.error).toContain('contrato ativo');
    expect((await q1<any>('SELECT name FROM people WHERE id=$1', [t.p.id])).name).toBe('Maria Titular');
  });
});

describe('Fase 13 — retenção de contatos do site', () => {
  it('apaga só contatos antigos não convertidos, da própria imobiliária', async () => {
    const A = await newOrg(app, 'RetA'); const B = await newOrg(app, 'RetB');
    const ta = await titular(A.admin); const tb = await titular(B.admin);
    const ins = (org: string, status: string, ageDays: number) => q(`INSERT INTO portal_leads(org_id,property_id,name,consent_text,status,created_at) SELECT $1,id,'L-'||$2,'ok',$2,now() - ($3::int * interval '1 day') FROM properties WHERE org_id=$1 LIMIT 1`, [org, status, ageDays]);
    await ins(ta.org, 'descartado', 400); await ins(ta.org, 'novo', 500); await ins(ta.org, 'convertido', 800); await ins(ta.org, 'novo', 10); await ins(tb.org, 'novo', 600);
    expect((await A.admin.post('/api/privacy/purge-leads', { older_than_days: 5 })).status).toBe(400); // mínimo 30
    expect((await (await addUser(app, A.admin, 'gestor')).post('/api/privacy/purge-leads', { older_than_days: 365 })).status).toBe(403);
    const r = await A.admin.post('/api/privacy/purge-leads', { older_than_days: 365 });
    expect(r.status).toBe(200); expect(r.body.apagados).toBe(2);
    const left = (await q<any>('SELECT status FROM portal_leads WHERE org_id=$1 ORDER BY status', [ta.org])).map((x) => x.status);
    expect(left).toEqual(['convertido', 'novo', 'novo']); // o convertido e os recentes ficam (o 'novo' do titular de teste também)
    expect((await q('SELECT 1 FROM portal_leads WHERE org_id=$1', [tb.org])).length).toBe(2); // outra imobiliária intacta
  });
});
