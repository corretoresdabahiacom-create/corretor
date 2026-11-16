import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import { config } from '../lib/config.js';

// NUMERIC/BIGINT chegam como string por padrão; convertemos NUMERIC para number (valores monetários cabem em double no MVP).
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

// Em Cloudflare Workers uma conexão não pode ser reaproveitada entre requisições: o worker cria um pool por
// requisição e o executa dentro deste contexto. Em Node o pool global é usado normalmente.
export const poolStore = new AsyncLocalStorage<pg.Pool>();
const cur = () => poolStore.getStore() ?? pool;

export async function q<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const r = await cur().query(text, params as any[]);
  return r.rows as T[];
}

export async function q1<T = any>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await cur().connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
