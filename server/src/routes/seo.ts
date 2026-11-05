import type { FastifyInstance } from 'fastify';
import { q } from '../db/pool.js';
import { config } from '../lib/config.js';

const xml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!));

export async function seoRoutes(app: FastifyInstance) {
  const base = () => config.publicOrigin.replace(/\/$/, '');
  app.get('/robots.txt', async (_r, reply) =>
    reply.type('text/plain').send(`User-agent: *\nAllow: /p/\nDisallow: /api/\nDisallow: /entrar\nDisallow: /convite/\nDisallow: /redefinir/\nSitemap: ${base()}/sitemap.xml\n`));
  app.get('/sitemap.xml', async (_r, reply) => {
    const rows = await q<any>(`SELECT public_code, COALESCE(updated_at, published_at) AS lastmod FROM properties WHERE published_at IS NOT NULL AND status='disponivel' AND public_code IS NOT NULL ORDER BY published_at DESC LIMIT 5000`);
    const orgs = await q<any>(`SELECT DISTINCT o.slug FROM organizations o JOIN properties p ON p.org_id=o.id WHERE p.published_at IS NOT NULL AND p.status='disponivel' LIMIT 2000`);
    const body = orgs.map((o) => `<url><loc>${xml(`${base()}/v/${o.slug}`)}</loc></url>`).join('') + rows.map((r) => `<url><loc>${xml(`${base()}/p/${r.public_code}`)}</loc><lastmod>${new Date(r.lastmod).toISOString().slice(0, 10)}</lastmod></url>`).join('');
    return reply.type('application/xml').header('cache-control', 'public, max-age=3600').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`);
  });
}
