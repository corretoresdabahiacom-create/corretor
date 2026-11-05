import pg from 'pg';

// Zera o schema do banco de TESTE e reaplica todas as migrações (valida também as migrações do zero).
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://imobflow:imobflow_dev@127.0.0.1:5432/imobflow_test';
  if (!/test/.test(url)) throw new Error('Recusando limpar um banco cujo nome não contém "test".');
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await c.end();
  process.env.DATABASE_URL = url;
  const { migrate } = await import('../src/db/migrate.js');
  await migrate();
  const { pool } = await import('../src/db/pool.js');
  await pool.end();
}
