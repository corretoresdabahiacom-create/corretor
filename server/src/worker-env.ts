// Importado primeiro pelo worker: copia vars/segredos do Cloudflare para process.env antes de `config` ser avaliado.
import { env } from 'cloudflare:workers';
for (const [k, v] of Object.entries(env as Record<string, unknown>)) if (typeof v === 'string') process.env[k] = v;
