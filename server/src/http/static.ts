// Servidor de arquivos estáticos do build do web (só Node; no Cloudflare os arquivos vêm do Workers Assets).
import path from 'node:path';
import type { HttpReply, HttpRequest } from './mini.js';

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.map': 'application/json' };

export function staticFallback(webDist: string) {
  const root = path.resolve(webDist);
  return async (req: HttpRequest, reply: HttpReply) => {
    const fs = await import('node:fs/promises');
    const u = req.url.split('?')[0];
    const isApi = u.startsWith('/api/') || u.startsWith('/p/') || u.startsWith('/v/');
    if (req.method !== 'GET' || isApi) return reply.code(404).send({ error: 'Não encontrado.' });
    let decoded: string;
    try { decoded = decodeURIComponent(u); } catch { return reply.code(400).send({ error: 'Endereço inválido.' }); }
    let file = path.join(root, decoded);
    // "root + sep": sem isso, /x/web/dist2/... passaria por começar com /x/web/dist
    if (file !== root && !file.startsWith(root + path.sep)) return reply.code(404).send({ error: 'Não encontrado.' });
    let data = await fs.readFile(file).catch(() => null);
    if (!data) {
      if (u.startsWith('/assets/') || /\.[a-z0-9]{2,5}$/i.test(u)) return reply.code(404).send({ error: 'Não encontrado.' });
      file = path.join(root, 'index.html'); data = await fs.readFile(file).catch(() => null);
      if (!data) return reply.code(404).send({ error: 'Não encontrado.' });
    }
    // Arquivos com hash (assets/) nunca mudam; o resto precisa revalidar para o app atualizar.
    if (/[\\/]assets[\\/]/.test(file)) reply.header('cache-control', 'public, max-age=31536000, immutable');
    else if (/sw\.js$/.test(file)) { reply.header('cache-control', 'no-cache'); reply.header('service-worker-allowed', '/'); }
    else if (/\.(html|webmanifest)$/.test(file)) reply.header('cache-control', 'no-cache');
    else reply.header('cache-control', 'public, max-age=86400');
    return reply.type(MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream').send(data);
  };
}
