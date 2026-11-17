// Ponto de entrada para Cloudflare Workers (plano gratuito). Em Node use src/index.ts.
import './worker-env.js';
import pg from 'pg';
import { buildApp } from './app.js';
import { config, productionProblems } from './lib/config.js';
import { poolStore } from './db/pool.js';
import { applyMigrations } from './db/migrate.js';
import { bundledMigrations } from './db/migrations.bundle.js';

// O Workers proíbe E/S e números aleatórios no escopo global: o app é montado na primeira requisição.
let app: ReturnType<typeof buildApp> | undefined;
let migrated = false; // por isolate: confere/aplica migrações uma vez (rápido quando o banco já está em dia)

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** Resposta de manutenção legível, no lugar do "Error 1101" genérico da Cloudflare. Nunca mostra valores de segredos. */
function unavailable(req: Request, title: string, items: string[], hint: string) {
  const path = new URL(req.url).pathname;
  const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (path.startsWith('/api/')) return Response.json({ ok: false, error: `${title}. ${hint}`, problems: items }, { status: 503, headers });
  const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<body style="font:16px/1.5 system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 16px;color:#1f2937"><h1 style="font-size:1.4rem">${esc(title)}</h1>
${items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}<p>${esc(hint)}</p></body></html>`;
  return new Response(html, { status: 503, headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } });
}

export default {
  async fetch(req: Request, _env: unknown, ctx: { waitUntil(p: Promise<unknown>): void }) {
    const problems = productionProblems();
    if (problems.length) {
      return unavailable(req, 'Configuração incompleta', problems,
        'No painel da Cloudflare: Workers & Pages → este Worker → Settings → Variables and Secrets. Cadastre como "Secret" e abra a página de novo. Passo a passo em docs/DEPLOY.md.');
    }
    // Uma conexão não pode atravessar requisições no Workers: pool próprio por requisição, encerrado ao final.
    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 3 });
    try {
      return await poolStore.run(pool, async () => {
        if (!migrated && process.env.AUTO_MIGRATE !== 'false') {
          const ran = await applyMigrations(bundledMigrations, pool);
          if (ran.length) console.log('Migrações aplicadas:', ran.join(', '));
          migrated = true;
        }
        app ??= buildApp({ logger: false }).catch((e) => { app = undefined; throw e; }); // falhou? tenta de novo na próxima
        return (await app).fetch(req);
      });
    } catch (e) {
      console.error('Falha ao atender a requisição:', (e as Error).message); // detalhes só no log (Observability)
      return unavailable(req, 'Serviço temporariamente indisponível', [],
        'Não foi possível acessar o banco de dados. Tente de novo em instantes. Se persistir, confira a DATABASE_URL (Neon, com ?sslmode=require) e os logs do Worker.');
    } finally {
      ctx.waitUntil(pool.end().catch(() => {}));
    }
  },
};
