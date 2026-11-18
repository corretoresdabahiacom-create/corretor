// Fase 17 — auditoria do deploy no Cloudflare: migrações embutidas, cabeçalhos do app estático, origem, senhas legadas,
// cache limitado por bytes, diagnóstico de configuração e arquivos estáticos.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import argon2 from 'argon2';
import { newApp, newOrg, Client, uniq } from './helpers.js';
import { pool, q, q1 } from '../src/db/pool.js';
import { applyMigrations, fsMigrations } from '../src/db/migrate.js';
import { securityHeaderValues } from '../src/http/security.js';
import { ByteCache } from '../src/lib/byteCache.js';
import { staticFallback } from '../src/http/static.js';
import { createApp } from '../src/http/mini.js';
import type { FastifyInstance } from '../src/http/mini.js';

const root = path.resolve(__dirname, '..', '..');
let app: FastifyInstance;
beforeAll(async () => { app = await newApp(); });
afterAll(async () => { await app.close(); });

describe('migrações no Worker', () => {
  it('o bundle do Worker inclui todas as migrações .sql, na ordem', () => {
    const files = fs.readdirSync(path.join(root, 'server/src/db/migrations')).filter((f) => f.endsWith('.sql')).sort();
    const bundle = fs.readFileSync(path.join(root, 'server/src/db/migrations.bundle.ts'), 'utf8');
    const listed = [...bundle.matchAll(/name: '([^']+)'/g)].map((m) => m[1]);
    const imported = [...bundle.matchAll(/from '\.\/migrations\/([^']+)'/g)].map((m) => m[1]);
    expect(listed).toEqual(files);
    expect(imported).toEqual(files);
    const wr = fs.readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8');
    expect(wr).toMatch(/"type": "Text", "globs": \["\*\*\/\*\.sql"\]/);
  });

  it('aplicar de novo não faz nada; em paralelo, uma migração nova roda uma vez só', async () => {
    expect(await applyMigrations(fsMigrations(), pool)).toEqual([]);
    const name = `999_teste_${uniq()}.sql`, table = `mig_${uniq()}`;
    const extra = [...fsMigrations(), { name, sql: `CREATE TABLE ${table} (id int); INSERT INTO ${table} VALUES (1);` }];
    const [a, b] = await Promise.all([applyMigrations(extra, pool), applyMigrations(extra, pool)]);
    expect([...a, ...b]).toEqual([name]);
    expect((await q1(`SELECT count(*)::int n FROM ${table}`)).n).toBe(1);
    await q(`DROP TABLE ${table}`); await q('DELETE FROM schema_migrations WHERE name=$1', [name]);
  });

  it('migração com erro desfaz tudo e não fica registrada', async () => {
    const name = `998_quebrada_${uniq()}.sql`;
    await expect(applyMigrations([{ name, sql: 'CREATE TABLE x_ok_' + uniq() + ' (id int); SELECT coluna_que_nao_existe FROM users;' }], pool)).rejects.toThrow(name);
    expect(await q1('SELECT 1 FROM schema_migrations WHERE name=$1', [name])).toBeNull();
  });
});

describe('cabeçalhos de segurança', () => {
  it('o app web estático (_headers) usa exatamente a mesma política da API', () => {
    const txt = fs.readFileSync(path.join(root, 'web/public/_headers'), 'utf8');
    const block = txt.split(/\n(?=\/)/).find((b) => b.startsWith('/*\n'))!;
    expect(block).toBeTruthy();
    const got = Object.fromEntries(block.split('\n').slice(1).filter((l) => l.trim()).map((l) => { const i = l.indexOf(':'); return [l.slice(0, i).trim().toLowerCase(), l.slice(i + 1).trim()]; }));
    expect(got).toEqual(securityHeaderValues());
  });

  it('a API envia a mesma política', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/health' });
    for (const [k, v] of Object.entries(securityHeaderValues())) expect(r.headers[k]).toBe(v);
  });
});

describe('wrangler.jsonc', () => {
  it('rotas dinâmicas passam pelo Worker antes dos arquivos estáticos', () => {
    const wr = fs.readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8');
    for (const r of ['/api/*', '/p/*', '/v/*', '/d/*', '/ical/*', '/robots.txt', '/sitemap.xml']) expect(wr).toContain(`"${r}"`);
    expect(wr).toContain('"directory": "web/dist"');
    expect(wr).toContain('"main": "server/src/worker.ts"');
    expect(fs.existsSync(path.join(root, 'web/public/_redirects'))).toBe(false); // conflita com Workers Assets
  });
});

describe('health', () => {
  it('confere o banco', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/health' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, db: 'ok', runtime: 'node' });
  });
});

describe('origem confiável (CSRF)', () => {
  it('aceita Origin igual ao próprio host; recusa outro site', async () => {
    const { admin } = await newOrg(app, 'Origem');
    const send = (origin: string, host: string) => app.inject({ method: 'POST', url: '/api/people', payload: { name: 'Pessoa ' + uniq() }, headers: { cookie: admin.cookie, origin, host, 'content-type': 'application/json' } });
    expect((await send('http://meu-dominio.test', 'meu-dominio.test')).statusCode).toBe(201);
    expect((await send('https://evil.example', 'meu-dominio.test')).statusCode).toBe(403);
    expect((await send('https://meu-dominio.test.evil.example', 'meu-dominio.test')).statusCode).toBe(403);
  });
});

describe('senhas', () => {
  it('conta com hash que este ambiente não lê recebe orientação clara (não "senha incorreta")', async () => {
    const { email } = await newOrg(app, 'Legado');
    await q('UPDATE users SET password_hash=$2 WHERE email=$1', [email, '$2b$10$formatoQueNaoSuportamos']);
    const r = await new Client(app).post('/api/auth/login', { email, password: 'senhaSegura123' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('senha_legada');
  });

  it('login com hash argon2 (Node) funciona e regrava em PBKDF2 para o Cloudflare', async () => {
    const { email } = await newOrg(app, 'Argon');
    await q('UPDATE users SET password_hash=$2 WHERE email=$1', [email, await argon2.hash('senhaSegura123')]);
    const c = new Client(app);
    expect((await c.post('/api/auth/login', { email, password: 'errada123456' })).status).toBe(401);
    expect((await q1('SELECT password_hash h FROM users WHERE email=$1', [email])).h).toMatch(/^\$argon2/);
    expect((await c.post('/api/auth/login', { email, password: 'senhaSegura123' })).status).toBe(200);
    expect((await q1('SELECT password_hash h FROM users WHERE email=$1', [email])).h).toMatch(/^pbkdf2\$sha512\$100000\$/);
    expect((await new Client(app).post('/api/auth/login', { email, password: 'senhaSegura123' })).status).toBe(200);
  });

  it('e-mail inexistente: mesma resposta genérica', async () => {
    const r = await new Client(app).post('/api/auth/login', { email: `ninguem-${uniq()}@teste.dev`, password: 'qualquer123' });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('E-mail ou senha incorretos.');
  });
});

describe('cache limitado por bytes', () => {
  it('nunca passa do limite e mantém os usados recentemente', () => {
    const c = new ByteCache<{ data: Buffer }>(1000);
    for (let i = 0; i < 50; i++) c.set(`k${i}`, { data: Buffer.alloc(100) });
    expect(c.usedBytes).toBeLessThanOrEqual(1000);
    expect(c.get('k49')).toBeTruthy();
    expect(c.get('k0')).toBeUndefined();
    c.get('k40'); c.set('novo', { data: Buffer.alloc(100) });
    expect(c.get('k40')).toBeTruthy(); // usado há pouco: não foi expulso
    c.set('gigante', { data: Buffer.alloc(600) }); // > 1/4 do limite: não entra
    expect(c.get('gigante')).toBeUndefined();
  });
});

describe('arquivos estáticos (Node)', () => {
  it('não sai da pasta do build, nem por pasta vizinha com prefixo igual', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'imob-static-'));
    fs.mkdirSync(path.join(base, 'dist')); fs.mkdirSync(path.join(base, 'dist2'));
    fs.writeFileSync(path.join(base, 'dist', 'index.html'), '<p>app</p>');
    fs.writeFileSync(path.join(base, 'dist2', 'segredo.txt'), 'NAO');
    const a = createApp(); a.setNotFoundHandler(staticFallback(path.join(base, 'dist')));
    const get = async (u: string) => { const r = await a.inject({ method: 'GET', url: u }); return { s: r.statusCode, b: r.body }; };
    expect((await get('/qualquer-rota')).b).toContain('app');
    const t = await get('/..%2fdist2/segredo.txt');
    expect(t.b).not.toContain('NAO');
    expect(t.s).toBe(404);
    expect((await get('/%E0%A4%A')).s).toBe(400);
    fs.rmSync(base, { recursive: true, force: true });
  });
});

describe('diagnóstico de configuração de produção', () => {
  it('lista o que falta, só pelo nome, e aceita configuração completa', async () => {
    const keep = { ...process.env };
    try {
      vi.resetModules();
      process.env.NODE_ENV = 'production'; process.env.COOKIE_SECURE = 'true'; process.env.DEV_EXPOSE_TOKENS = 'false';
      delete process.env.DATABASE_URL; delete process.env.FORM_SECRET; delete process.env.PUBLIC_ORIGIN;
      let m = await import('../src/lib/config.js');
      const p = m.productionProblems().join('\n');
      expect(p).toContain('DATABASE_URL não definida');
      expect(p).toContain('FORM_SECRET não definido');
      expect(p).toContain('PUBLIC_ORIGIN não definido');

      vi.resetModules();
      process.env.DATABASE_URL = 'postgresql://u:segredo@ep-x.sa-east-1.aws.neon.tech/neondb?sslmode=require';
      process.env.FORM_SECRET = 'x'.repeat(40);
      process.env.PUBLIC_ORIGIN = 'https://corretor.exemplo.workers.dev/'; // barra no final é tolerada
      m = await import('../src/lib/config.js');
      expect(m.productionProblems()).toEqual([]);
      expect(m.config.publicOrigin).toBe('https://corretor.exemplo.workers.dev');
      expect(JSON.stringify(m.productionProblems())).not.toContain('segredo');
    } finally {
      process.env = keep; vi.resetModules();
    }
  });
});

describe('trocar senha (logado)', () => {
  it('exige a senha atual, valida a nova, mantém esta sessão e derruba as outras', async () => {
    const { admin, email } = await newOrg(app, 'Troca');
    const outro = new Client(app);
    expect((await outro.post('/api/auth/login', { email, password: 'senhaSegura123' })).status).toBe(200);
    expect((await admin.post('/api/auth/password', { current: 'errada123456', password: 'NovaSenha2026' })).status).toBe(400);
    expect((await admin.post('/api/auth/password', { current: 'senhaSegura123', password: 'curta1' })).status).toBe(400);
    expect((await admin.post('/api/auth/password', { current: 'senhaSegura123', password: 'senhaSegura123' })).status).toBe(400);
    expect((await admin.post('/api/auth/password', { current: 'senhaSegura123', password: 'NovaSenha2026' })).status).toBe(200);
    expect((await admin.get('/api/auth/me')).status).toBe(200);   // esta sessão continua
    expect((await outro.get('/api/auth/me')).status).toBe(401);   // outro aparelho caiu
    expect((await new Client(app).post('/api/auth/login', { email, password: 'senhaSegura123' })).status).toBe(401);
    expect((await new Client(app).post('/api/auth/login', { email, password: 'NovaSenha2026' })).status).toBe(200);
    expect((await new Client(app).post('/api/auth/password', { current: 'x', password: 'NovaSenha2027' })).status).toBe(401); // sem login
  });
});
