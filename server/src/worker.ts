// Ponto de entrada para Cloudflare Workers (plano gratuito). Em Node use src/index.ts.
import './worker-env.js';
import pg from 'pg';
import { buildApp } from './app.js';
import { config, assertProductionConfig } from './lib/config.js';
import { poolStore } from './db/pool.js';

// O Workers proíbe E/S e números aleatórios no escopo global: o app é montado na primeira requisição.
let app: ReturnType<typeof buildApp> | undefined;

export default {
  async fetch(req: Request, _env: unknown, ctx: { waitUntil(p: Promise<unknown>): void }) {
    assertProductionConfig();
    app ??= buildApp({ logger: false });
    // Uma conexão não pode atravessar requisições no Workers: pool próprio por requisição, encerrado ao final.
    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 3 });
    try {
      return await poolStore.run(pool, async () => (await app!).fetch(req));
    } finally {
      ctx.waitUntil(pool.end().catch(() => {}));
    }
  },
};
