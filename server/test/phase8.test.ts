import { describe, it, expect, beforeAll } from 'vitest';
import { newApp, newOrg, addUser, Client, uniq } from './helpers.js';
import { q, q1 } from '../src/db/pool.js';

let app: any;
beforeAll(async () => { app = await newApp(); });
const PASS = 'senhaSegura123';

describe('Fase 8 — excluir conta', () => {
  it('exige senha correta e a palavra EXCLUIR', async () => {
    const A = await newOrg(app, 'ExcA');
    expect((await A.admin.post('/api/auth/account/delete', { password: 'errada-123456', confirm: 'EXCLUIR' })).status).toBe(400);
    expect((await A.admin.post('/api/auth/account/delete', { password: PASS, confirm: 'talvez' })).status).toBe(400);
    expect((await A.admin.get('/api/auth/me')).status).toBe(200); // nada foi apagado
    expect((await new Client(app).post('/api/auth/account/delete', { password: PASS, confirm: 'EXCLUIR' })).status).toBe(401);
  });

  it('admin apaga a imobiliária inteira sem afetar as outras', async () => {
    const A = await newOrg(app, 'ExcA'); const B = await newOrg(app, 'ExcB');
    const corretor = await addUser(app, A.admin, 'corretor');
    await A.admin.post('/api/people', { kind: 'fisica', name: 'Cliente A' });
    await B.admin.post('/api/people', { kind: 'fisica', name: 'Cliente B' });
    const org = await q1<any>('SELECT o.id, o.slug FROM organizations o JOIN users u ON u.org_id=o.id WHERE u.email=$1', [A.email]);
    // B foi indicada por A: não pode bloquear a exclusão
    await q('UPDATE organizations SET referred_by_org=$1 WHERE id=(SELECT org_id FROM users WHERE email=$2)', [org.id, B.email]);
    const r = await A.admin.post('/api/auth/account/delete', { password: PASS, confirm: 'excluir' });
    expect(r.status).toBe(200);
    expect(await q1('SELECT 1 FROM organizations WHERE id=$1', [org.id])).toBeNull();
    expect((await q('SELECT 1 FROM users WHERE org_id=$1', [org.id])).length).toBe(0);
    expect((await q('SELECT 1 FROM people WHERE org_id=$1', [org.id])).length).toBe(0);
    expect((await A.admin.get('/api/auth/me')).status).toBe(401);
    expect((await corretor.get('/api/auth/me')).status).toBe(401); // sessão do colega também cai
    expect((await app.inject({ method: 'GET', url: `/v/${org.slug}` })).statusCode).toBe(404);
    const login = await new Client(app).post('/api/auth/login', { email: A.email, password: PASS });
    expect(login.status).toBe(401);
    // outra imobiliária intacta
    expect((await B.admin.get('/api/auth/me')).status).toBe(200);
    expect(JSON.stringify((await B.admin.get('/api/people')).body)).toContain('Cliente B');
  });

  it('usuário comum só perde o próprio acesso (anonimizado)', async () => {
    const A = await newOrg(app, 'ExcC');
    const email = `corr-${uniq()}@teste.dev`;
    const inv = await A.admin.post('/api/invites', { email, role: 'corretor' });
    const c = new Client(app);
    await c.post('/api/invites/accept', { token: inv.body.link.split('/convite/')[1], name: 'Corretor Z', password: PASS });
    await c.post('/api/auth/login', { email, password: PASS });
    await c.post('/api/people', { kind: 'fisica', name: 'Cadastro do corretor' }); // referencia o usuário (created_by)
    expect((await c.post('/api/auth/account/delete', { password: PASS, confirm: 'EXCLUIR' })).status).toBe(200);
    expect((await c.get('/api/auth/me')).status).toBe(401);
    expect((await new Client(app).post('/api/auth/login', { email, password: PASS })).status).toBe(401);
    expect(await q1('SELECT 1 FROM users WHERE email=$1', [email])).toBeNull(); // e-mail removido
    expect((await A.admin.get('/api/auth/me')).status).toBe(200); // imobiliária e dados continuam
    expect((await A.admin.get('/api/users')).body.some((u: any) => u.name === 'Usuário excluído' && !u.active)).toBe(true);
  });
});

describe('Fase 8 — pré-visualização ao vivo', () => {
  it('mostra o rascunho sem salvar; valida permissões e imagens', async () => {
    const A = await newOrg(app, 'PvA');
    const corretor = await addUser(app, A.admin, 'corretor');
    const before = (await A.admin.get('/api/site')).body.site;
    const r = await A.admin.req('POST', '/api/site/preview', { hero: { title: 'Titulo-Rascunho-XYZ' }, theme: { bg: '#0f141a' } });
    expect(r.status).toBe(200);
    expect(String(r.body)).toContain('Titulo-Rascunho-XYZ');
    expect(String(r.headers['cache-control'])).toContain('no-store');
    expect((await A.admin.get('/api/site')).body.site).toEqual(before); // nada gravado
    const slug = (await q1<any>('SELECT o.slug FROM organizations o JOIN users u ON u.org_id=o.id WHERE u.email=$1', [A.email])).slug;
    expect((await app.inject({ method: 'GET', url: `/v/${slug}` })).body).not.toContain('Titulo-Rascunho-XYZ'); // vitrine pública intacta
    expect((await corretor.post('/api/site/preview', { hero: { title: 'x' } })).status).toBe(403);
    expect((await new Client(app).post('/api/site/preview', {})).status).toBe(401);
    expect((await A.admin.post('/api/site/preview', { hero: { images: ['00000000-0000-4000-8000-000000000000'] } })).status).toBe(400);
    expect((await A.admin.post('/api/site/preview', { theme: { bg: 'azul' } })).status).toBe(400);
  });
});

describe('Fase 8 — RLS', () => {
  it('todas as tabelas públicas têm RLS ligada e nada é concedido a PUBLIC', async () => {
    const off = await q<any>(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity`);
    expect(off.map((r) => r.relname)).toEqual([]);
    const pub = await q<any>(`SELECT table_name FROM information_schema.role_table_grants WHERE table_schema='public' AND grantee='PUBLIC'`);
    expect(pub).toEqual([]);
  });
});
