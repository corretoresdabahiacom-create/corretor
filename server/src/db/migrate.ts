import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function migrate(): Promise<string[]> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  const applied = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const ran: string[] = [];
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
      await c.query('COMMIT');
      ran.push(f);
    } catch (e) {
      await c.query('ROLLBACK');
      throw new Error(`Falha na migração ${f}: ${(e as Error).message}`);
    } finally {
      c.release();
    }
  }
  return ran;
}

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
