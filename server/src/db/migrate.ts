import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { pool } from './pool.js';

export type Migration = { name: string; sql: string };

// Trava transacional (funciona também com o pooler do Neon): duas instâncias subindo juntas nunca aplicam a mesma migração.
const LOCK_KEY = 4815162342;

/** Aplica, em ordem, as migrações ainda não registradas. Cada uma roda numa transação própria. */
export async function applyMigrations(list: Migration[], p: Pick<pg.Pool, 'connect'>): Promise<string[]> {
  const c = await p.connect();
  const ran: string[] = [];
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const applied = new Set((await c.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    await c.query('COMMIT');
    for (const m of [...list].sort((a, b) => a.name.localeCompare(b.name))) {
      if (applied.has(m.name)) continue;
      try {
        await c.query('BEGIN');
        await c.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
        // outra instância pode ter aplicado enquanto esperávamos a trava
        if ((await c.query('SELECT 1 FROM schema_migrations WHERE name=$1', [m.name])).rowCount) { await c.query('COMMIT'); continue; }
        await c.query(m.sql);
        await c.query('INSERT INTO schema_migrations(name) VALUES ($1)', [m.name]);
        await c.query('COMMIT');
        ran.push(m.name);
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw new Error(`Falha na migração ${m.name}: ${(e as Error).message}`);
      }
    }
    return ran;
  } finally {
    c.release();
  }
}

/** Lê as migrações da pasta (Node). No Cloudflare Workers elas vêm embutidas no bundle (migrations.bundle.ts). */
export function fsMigrations(): Migration[] {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((name) => ({ name, sql: fs.readFileSync(path.join(dir, name), 'utf8') }));
}

export const migrate = () => applyMigrations(fsMigrations(), pool);

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate()
    .then((r) => {
      console.log(r.length ? `Migrações aplicadas: ${r.join(', ')}` : 'Banco já está atualizado.');
      return pool.end();
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
