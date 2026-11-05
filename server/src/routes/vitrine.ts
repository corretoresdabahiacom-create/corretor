import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { q, q1 } from '../db/pool.js';
import { audit, requireAuth, requirePerm } from '../lib/auth.js';
import { config } from '../lib/config.js';
import { storage, sniffMime } from '../lib/storage.js';
import { HEX, brandOf, escXml as esc, onColor, type Brand } from '../lib/brand.js';
import { plainQrSvg, renderCard } from '../lib/card.js';
import { isValidPhone, normalizePhone } from '../lib/validators.js';
import { CONSENT_TEXT, bump, formToken, loadPublic } from './portal.js';
import { DEFAULT_SITE, parseFilters, hasFilters, siteInput, siteOf, videosInput } from '../lib/site.js';
import { renderHome, renderProperty, type SiteCtx } from '../lib/siteRender.js';
import { DEFAULT_APP_THEME, appThemeInput, appThemeOf, effectiveTheme } from '../lib/appTheme.js';

const rl = (max: number, timeWindow: string) => ({ config: { rateLimit: (process.env.RATE_LIMIT_DISABLED === 'true' ? false : { max, timeWindow }) as false | { max: number; timeWindow: string } } });
const base = () => config.publicOrigin.replace(/\/$/, '');
const brl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(n);
const SOURCES = ['link', 'qr', 'cartao'];
const vitrineUrl = (slug: string, src?: string) => `${base()}/v/${slug}${src ? `?o=${src}` : ''}`;
const phoneFmt = (p?: string | null) => { const d = String(p ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, ''); return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : p ?? ''; };

async function loadLogo(orgId: string): Promise<Buffer | null> {
  const a = await q1<any>(`SELECT storage_key FROM org_assets WHERE org_id=$1 AND kind='logo'`, [orgId]);
  return a ? storage().get(a.storage_key).catch(() => null) : null;
}

async function loadVitrine(slug: string) {
  const org = await q1<any>(`SELECT id,name,slug,plan,brand,site,public_name,public_whatsapp,public_badge FROM organizations WHERE slug=$1`, [slug]);
  if (!org) return null;
  const rows = await q<any>(
    `SELECT p.id,p.public_code,p.title,p.description,p.kind,p.subtype,p.purposes,p.location_tags,p.city,p.state,p.neighborhood,p.price_sale,p.price_rent,p.price_lease,p.show_price,p.area_total,p.area_unit,p.bedrooms,p.bathrooms,p.parking,p.featured,p.features,jsonb_array_length(p.videos) AS video_count,
       (SELECT f.id FROM files f WHERE f.property_id=p.id AND f.category='foto' AND f.visibility='publico' ORDER BY f.is_cover DESC, f.position LIMIT 1) AS cover_id,
       (SELECT count(*)::int FROM files f WHERE f.property_id=p.id AND f.category='foto' AND f.visibility='publico') AS photo_count
     FROM properties p WHERE p.org_id=$1 AND p.published_at IS NOT NULL AND p.status='disponivel' ORDER BY p.featured DESC, p.published_at DESC LIMIT 200`, [org.id]);
  const brand = brandOf(org.brand);
  return { org, brand, site: siteOf(org.site, brand.layout), rows };
}

const hexOrEmpty = z.union([z.string().regex(HEX, 'Cor inválida. Use o formato #RRGGBB.'), z.literal('')]);
export async function vitrineRoutes(app: FastifyInstance) {
  // ---------- público ----------
  const NOT_FOUND = (msg: string) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Não encontrado</title><p style="font:18px system-ui;padding:2rem;max-width:560px;margin:auto">${msg}</p>`;
  const isBot = (req: any) => /bot|crawl|spider|preview|facebookexternalhit|whatsapp|slack|telegram/i.test(String(req.headers['user-agent'] ?? ''));
  const ctxOf = async (v: NonNullable<Awaited<ReturnType<typeof loadVitrine>>>, preview: boolean): Promise<SiteCtx> => ({
    org: v.org, brand: v.brand, site: v.site, base: base(), preview,
    hasLogo: !!(await q1(`SELECT 1 FROM org_assets WHERE org_id=$1 AND kind='logo'`, [v.org.id])),
  });

  app.get('/v/:slug', rl(120, '1 minute'), async (req, reply) => {
    const slug = String((req.params as any).slug);
    const v = /^[a-z0-9-]{2,80}$/.test(slug) ? await loadVitrine(slug) : null;
    if (!v) return reply.code(404).type('text/html').send(NOT_FOUND('Esta vitrine não existe.'));
    const qy = req.query as any; const f = parseFilters(qy); const preview = qy.preview === '1';
    const o = String(qy.o ?? 'link'); const source = SOURCES.includes(o) ? o : 'link';
    // Conta só a chegada (sem filtros), nunca robôs nem a pré-visualização do editor.
    if (!preview && !hasFilters(f) && !isBot(req))
      await q(`INSERT INTO vitrine_stats(org_id,day,source,n) VALUES ($1,CURRENT_DATE,$2,1) ON CONFLICT (org_id,day,source) DO UPDATE SET n=vitrine_stats.n+1`, [v.org.id, source]);
    const html = renderHome(await ctxOf(v, preview), v.rows, f, formToken(`v:${v.org.slug}`), CONSENT_TEXT);
    return reply.header('cache-control', preview ? 'no-store' : 'public, max-age=60').type('text/html; charset=utf-8').send(html);
  });

  app.get('/v/:slug/imovel/:code', rl(120, '1 minute'), async (req, reply) => {
    const { slug, code } = req.params as any;
    const v = /^[a-z0-9-]{2,80}$/.test(slug) ? await loadVitrine(slug) : null;
    const d = v ? await loadPublic(String(code)) : null;
    // O imóvel precisa ser desta imobiliária (isolamento entre organizações).
    if (!v || !d || d._org !== v.org.id) return reply.code(404).type('text/html').send(NOT_FOUND('Este imóvel não está mais disponível. <a href="/v/' + esc(slug) + '">Ver outros imóveis</a>'));
    const preview = (req.query as any).preview === '1';
    if (!preview && !isBot(req)) await bump(d._org, d._id, 'view', 'vitrine');
    const me = v.rows.find((r) => r.public_code === d.code);
    const similar = v.rows.filter((r) => r.public_code !== d.code && (r.kind === d.kind) && r.purposes.some((x: string) => d.purposes.includes(x)))
      .sort((a, b) => Number(b.city === me?.city) - Number(a.city === me?.city)).slice(0, 3);
    const html = renderProperty(await ctxOf(v, preview), d, similar, formToken(d.code), CONSENT_TEXT);
    return reply.header('cache-control', preview ? 'no-store' : 'public, max-age=60').header('referrer-policy', 'strict-origin-when-cross-origin').type('text/html; charset=utf-8').send(html);
  });

  // ---------- editor do site (somente admin/gestor com org.manage) ----------
  app.get('/api/site', { preHandler: requirePerm('org.manage') }, async (req) => {
    const o = await q1<any>('SELECT slug,site,brand FROM organizations WHERE id=$1', [req.user!.orgId]);
    const imgs = await q<any>('SELECT id,width,height,size_bytes,created_at FROM site_images WHERE org_id=$1 ORDER BY created_at DESC', [req.user!.orgId]);
    return { site: siteOf(o.site, brandOf(o.brand).layout), images: imgs.map((i) => ({ ...i, url: `/api/public/site/${o.slug}/img/${i.id}?w=400` })), preview_url: `/v/${o.slug}?preview=1`, defaults: DEFAULT_SITE };
  });

  app.patch('/api/site', { preHandler: requirePerm('org.manage') }, async (req, reply) => {
    const b = siteInput.parse(req.body);
    const o = await q1<any>('SELECT site,brand FROM organizations WHERE id=$1', [req.user!.orgId]);
    const cur = siteOf(o.site, brandOf(o.brand).layout);
    // Imagens citadas precisam ser desta imobiliária.
    const ids = [...(b.hero?.images ?? []), ...(b.about?.image ? [b.about.image] : []), ...(b.gallery ?? []).map((g) => g.id)];
    if (ids.length) {
      const ok = await q<any>('SELECT id FROM site_images WHERE org_id=$1 AND id = ANY($2::uuid[])', [req.user!.orgId, ids]);
      if (ok.length !== new Set(ids).size) return reply.code(400).send({ error: 'Imagem não encontrada. Envie a foto de novo.' });
    }
    const next = { ...cur, ...b, theme: { ...cur.theme, ...(b.theme ?? {}) }, hero: { ...cur.hero, ...(b.hero ?? {}) }, about: { ...cur.about, ...(b.about ?? {}) }, contact: { ...cur.contact, ...(b.contact ?? {}) } };
    if (b.sections) next.sections = siteOf({ sections: b.sections }).sections;
    await q('UPDATE organizations SET site=$2::jsonb WHERE id=$1', [req.user!.orgId, JSON.stringify(next)]);
    await audit(req, 'site.update', 'organization', req.user!.orgId);
    return { ok: true, site: next };
  });

  app.post('/api/site/images', { preHandler: requirePerm('org.manage') }, async (req, reply) => {
    const n = await q1<any>('SELECT count(*)::int n FROM site_images WHERE org_id=$1', [req.user!.orgId]);
    if (n.n >= 60) return reply.code(409).send({ error: 'Limite de 60 imagens do site. Exclua alguma antes de enviar outra.' });
    const part = await (req as any).file({ limits: { fileSize: 10 * 1024 * 1024 } });
    if (!part) return reply.code(400).send({ error: 'Envie uma imagem.' });
    const raw: Buffer = await part.toBuffer().catch(() => Buffer.alloc(0));
    if (part.file.truncated || !raw.length) return reply.code(413).send({ error: 'Imagem muito grande (máx. 10 MB).' });
    const mime = sniffMime(raw);
    if (!mime || mime === 'application/pdf') return reply.code(415).send({ error: 'Use uma imagem JPG, PNG ou WebP.' });
    // Reprocessa (remove metadados como localização GPS) e limita a 2000 px.
    const out = await sharp(raw).rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 84, mozjpeg: true }).toBuffer({ resolveWithObject: true }).catch(() => null);
    if (!out) return reply.code(415).send({ error: 'Não foi possível ler a imagem.' });
    const key = `${req.user!.orgId}/${crypto.randomUUID()}`;
    await storage().put(key, out.data, 'image/jpeg');
    const row = await q1<any>(`INSERT INTO site_images(org_id,mime,size_bytes,width,height,sha256,storage_key) VALUES ($1,'image/jpeg',$2,$3,$4,$5,$6) RETURNING id`,
      [req.user!.orgId, out.data.length, out.info.width, out.info.height, crypto.createHash('sha256').update(out.data).digest('hex'), key]);
    await audit(req, 'site.image.add', 'site_image', row.id);
    return reply.code(201).send({ id: row.id });
  });

  app.delete('/api/site/images/:id', { preHandler: requirePerm('org.manage') }, async (req, reply) => {
    const id = z.string().uuid().safeParse((req.params as any).id);
    const row = id.success ? await q1<any>('DELETE FROM site_images WHERE id=$1 AND org_id=$2 RETURNING storage_key', [id.data, req.user!.orgId]) : null;
    if (!row) return reply.code(404).send({ error: 'Imagem não encontrada.' });
    await storage().del(row.storage_key).catch(() => {});
    // Remove a imagem de onde ela era usada no site.
    const o = await q1<any>('SELECT site FROM organizations WHERE id=$1', [req.user!.orgId]); const st = siteOf(o.site);
    st.hero.images = st.hero.images.filter((x) => x !== id.data); if (st.about.image === id.data) st.about.image = ''; st.gallery = st.gallery.filter((g) => g.id !== id.data);
    await q('UPDATE organizations SET site=$2::jsonb WHERE id=$1', [req.user!.orgId, JSON.stringify(st)]);
    await q(`UPDATE organizations SET app_theme = app_theme || '{"banner_image":""}'::jsonb WHERE id=$1 AND app_theme->>'banner_image'=$2`, [req.user!.orgId, id.data]);
    await audit(req, 'site.image.delete', 'site_image', id.data!);
    return { ok: true };
  });

  const siteThumbs = new Map<string, Buffer>();
  app.get('/api/public/site/:slug/img/:id', rl(300, '1 minute'), async (req, reply) => {
    const { slug, id } = req.params as any;
    if (!z.string().uuid().safeParse(id).success) return reply.code(404).send({ error: 'Imagem não encontrada.' });
    const row = await q1<any>('SELECT i.id,i.storage_key FROM site_images i JOIN organizations o ON o.id=i.org_id WHERE i.id=$1 AND o.slug=$2', [id, String(slug)]);
    if (!row) return reply.code(404).send({ error: 'Imagem não encontrada.' });
    const w = Number((req.query as any).w); const width = [400, 600, 1000, 1200, 1600].includes(w) ? w : 1200;
    const ck = `${row.id}:${width}`; let buf = siteThumbs.get(ck);
    if (!buf) {
      const data = await storage().get(row.storage_key).catch(() => null); if (!data) return reply.code(404).send({ error: 'Imagem não encontrada.' });
      buf = await sharp(data).resize({ width, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
      siteThumbs.set(ck, buf); if (siteThumbs.size > 300) siteThumbs.delete(siteThumbs.keys().next().value!);
    }
    return reply.header('content-type', 'image/webp').header('cache-control', 'public, max-age=86400').header('x-content-type-options', 'nosniff').send(buf);
  });

  // ---------- aparência do app (admin edita; todos aplicam via /api/auth/me) ----------
  app.get('/api/app-theme', { preHandler: requirePerm('org.manage') }, async (req) => {
    const o = await q1<any>('SELECT slug,app_theme,site,brand FROM organizations WHERE id=$1', [req.user!.orgId]);
    return { theme: appThemeOf(o.app_theme), effective: effectiveTheme(o), defaults: DEFAULT_APP_THEME };
  });
  app.patch('/api/app-theme', { preHandler: requirePerm('org.manage') }, async (req, reply) => {
    const b = appThemeInput.parse(req.body);
    if (b.banner_image && !(await q1('SELECT 1 FROM site_images WHERE id=$1 AND org_id=$2', [b.banner_image, req.user!.orgId])))
      return reply.code(400).send({ error: 'Imagem não encontrada. Envie a foto de novo.' });
    const o = await q1<any>('SELECT slug,app_theme,site,brand FROM organizations WHERE id=$1', [req.user!.orgId]);
    const next = { ...appThemeOf(o.app_theme), ...b };
    await q('UPDATE organizations SET app_theme=$2::jsonb WHERE id=$1', [req.user!.orgId, JSON.stringify(next)]);
    await audit(req, 'app_theme.update', 'organization', req.user!.orgId);
    return { theme: next, effective: effectiveTheme({ ...o, app_theme: next }) };
  });

  // ---------- vídeos dos imóveis (links do YouTube/Vimeo) ----------
  app.put('/api/properties/:id/videos', { preHandler: requirePerm('properties.write') }, async (req, reply) => {
    const id = z.string().uuid().safeParse((req.params as any).id);
    const videos = z.object({ videos: videosInput }).parse(req.body).videos;
    const row = id.success ? await q1<any>('UPDATE properties SET videos=$3::jsonb, updated_at=now() WHERE id=$1 AND org_id=$2 RETURNING id', [id.data, req.user!.orgId, JSON.stringify(videos)]) : null;
    if (!row) return reply.code(404).send({ error: 'Imóvel não encontrado.' });
    await audit(req, 'property.videos', 'property', row.id);
    return { videos };
  });

  app.get('/api/public/brand/:slug/logo', rl(300, '1 minute'), async (req, reply) => {
    const org = await q1<any>('SELECT id FROM organizations WHERE slug=$1', [String((req.params as any).slug)]);
    const buf = org ? await loadLogo(org.id) : null;
    if (!buf) return reply.code(404).send({ error: 'Sem logomarca.' });
    return reply.header('content-type', 'image/png').header('cache-control', 'public, max-age=300').header('x-content-type-options', 'nosniff').send(buf);
  });

  app.get('/api/public/vitrine/:slug/qr.svg', rl(120, '1 minute'), async (req, reply) => {
    const slug = String((req.params as any).slug);
    if (!(await q1('SELECT 1 FROM organizations WHERE slug=$1', [slug]))) return reply.code(404).send({ error: 'Não encontrada.' });
    const o = String((req.query as any).o ?? 'qr');
    return reply.header('content-type', 'image/svg+xml').header('cache-control', 'public, max-age=3600').send(plainQrSvg(vitrineUrl(slug, SOURCES.includes(o) ? o : 'qr')));
  });

  // ---------- marca (admin) ----------
  app.get('/api/brand', { preHandler: requireAuth }, async (req) => {
    const o = await q1<any>('SELECT slug,name,brand,public_name,public_whatsapp FROM organizations WHERE id=$1', [req.user!.orgId]);
    const has = !!(await q1(`SELECT 1 FROM org_assets WHERE org_id=$1 AND kind='logo'`, [req.user!.orgId]));
    const n = await q1<any>(`SELECT count(*)::int n FROM properties WHERE org_id=$1 AND published_at IS NOT NULL AND status='disponivel'`, [req.user!.orgId]);
    return { brand: brandOf(o.brand), has_logo: has, logo_url: has ? `/api/public/brand/${o.slug}/logo` : null, vitrine_url: vitrineUrl(o.slug), vitrine_qr_url: `/api/public/vitrine/${o.slug}/qr.svg`, name: o.public_name || o.name, listed: n.n };
  });

  app.patch('/api/brand', { preHandler: requirePerm('org.manage') }, async (req) => {
    const b = z.object({
      primary: z.string().regex(HEX, 'Cor inválida. Use o formato #RRGGBB.').optional(), secondary: z.string().regex(HEX, 'Cor inválida. Use o formato #RRGGBB.').optional(),
      tagline: z.string().trim().max(80).optional(), title: z.string().trim().max(80).optional(), intro: z.string().trim().max(400).optional(),
      services: z.array(z.string().trim().min(2).max(40)).min(1, 'Informe ao menos um serviço.').max(5, 'No máximo 5 serviços.').optional(), layout: z.enum(['grade', 'lista']).optional(), card_layout: z.enum(['classico', 'moderno', 'minimal']).optional(),
      card: z.object({ bg: hexOrEmpty, fg: hexOrEmpty, accent: hexOrEmpty, headline_text: z.string().trim().max(40), sub_text: z.string().trim().max(60), services_title: z.string().trim().max(22), button_label: z.string().trim().max(18), contacts: z.array(z.string().trim().max(42)).max(4) }).partial().optional(),
    }).parse(req.body);
    if (b.card) { const cur = brandOf((await q1<any>('SELECT brand FROM organizations WHERE id=$1', [req.user!.orgId]))?.brand).card; b.card = { ...cur, ...b.card }; }
    await q(`UPDATE organizations SET brand = brand || $2::jsonb WHERE id=$1`, [req.user!.orgId, JSON.stringify(b)]);
    await audit(req, 'brand.update', 'organization', req.user!.orgId);
    return { ok: true };
  });

  app.post('/api/brand/logo', { preHandler: requirePerm('org.manage') }, async (req, reply) => {
    const part = await (req as any).file({ limits: { fileSize: 2 * 1024 * 1024 } });
    if (!part) return reply.code(400).send({ error: 'Envie a imagem da logomarca.' });
    const raw: Buffer = await part.toBuffer().catch(() => Buffer.alloc(0));
    if (part.file.truncated || !raw.length) return reply.code(413).send({ error: 'Logomarca muito grande (máx. 2 MB).' });
    const mime = sniffMime(raw);
    if (!mime || mime === 'application/pdf') return reply.code(415).send({ error: 'Use uma imagem PNG, JPG ou WebP (SVG não é aceito).' });
    // Reprocessa: remove metadados/conteúdo embutido e limita o tamanho. Sempre grava PNG.
    const png = await sharp(raw).rotate().resize({ width: 800, height: 400, fit: 'inside', withoutEnlargement: true }).png().toBuffer().catch(() => null);
    if (!png) return reply.code(415).send({ error: 'Não foi possível ler a imagem.' });
    const key = `${req.user!.orgId}/${crypto.randomUUID()}`;
    await storage().put(key, png, 'image/png');
    const old = await q1<any>(`SELECT storage_key FROM org_assets WHERE org_id=$1 AND kind='logo'`, [req.user!.orgId]);
    await q(`INSERT INTO org_assets(org_id,kind,mime,size_bytes,sha256,storage_key) VALUES ($1,'logo','image/png',$2,$3,$4) ON CONFLICT (org_id,kind) DO UPDATE SET mime=EXCLUDED.mime,size_bytes=EXCLUDED.size_bytes,sha256=EXCLUDED.sha256,storage_key=EXCLUDED.storage_key,updated_at=now()`,
      [req.user!.orgId, png.length, crypto.createHash('sha256').update(png).digest('hex'), key]);
    if (old) await storage().del(old.storage_key).catch(() => {});
    await audit(req, 'brand.logo', 'organization', req.user!.orgId);
    return reply.code(201).send({ ok: true });
  });

  app.delete('/api/brand/logo', { preHandler: requirePerm('org.manage') }, async (req) => {
    const old = await q1<any>(`DELETE FROM org_assets WHERE org_id=$1 AND kind='logo' RETURNING storage_key`, [req.user!.orgId]);
    if (old) await storage().del(old.storage_key).catch(() => {});
    return { ok: true };
  });

  app.patch('/api/properties/:id/feature', { preHandler: requirePerm('properties.write') }, async (req, reply) => {
    const { featured } = z.object({ featured: z.boolean() }).parse(req.body);
    const r = await q1(`UPDATE properties SET featured=$3 WHERE id=$1 AND org_id=$2 RETURNING id`, [z.string().uuid().parse((req.params as any).id), req.user!.orgId, featured]);
    return r ? { ok: true, featured } : reply.code(404).send({ error: 'Imóvel não encontrado.' });
  });

  // ---------- cartão de visita (do próprio usuário) ----------
  app.get('/api/card/profile', { preHandler: requireAuth }, async (req) => {
    const u = await q1<any>('SELECT name,email,card_profile FROM users WHERE id=$1', [req.user!.id]);
    return { name: u.name, email: u.email, ...{ title: '', phone: '', whatsapp: '', creci: '', card_email: '', headline: 'imobiliaria' }, ...u.card_profile };
  });
  app.patch('/api/card/profile', { preHandler: requireAuth }, async (req, reply) => {
    const b = z.object({ title: z.string().trim().max(60).optional(), phone: z.string().trim().max(30).optional(), whatsapp: z.string().trim().max(30).optional(), creci: z.string().trim().max(30).optional(), card_email: z.string().trim().max(120).email('E-mail inválido.').or(z.literal('')).optional(), headline: z.enum(['imobiliaria', 'corretor']).optional() }).parse(req.body);
    for (const k of ['phone', 'whatsapp'] as const) if (b[k] && !isValidPhone(b[k]!)) return reply.code(400).send({ error: 'Telefone inválido. Use DDD + número.' });
    await q(`UPDATE users SET card_profile = card_profile || $2::jsonb WHERE id=$1`, [req.user!.id, JSON.stringify(b)]);
    return { ok: true };
  });

  app.get('/api/card/:side', { preHandler: requireAuth, ...rl(60, '1 minute') }, async (req, reply) => {
    const m = /^(front|back)\.(png|svg)$/.exec(String((req.params as any).side));
    if (!m) return reply.code(404).send({ error: 'Não encontrado.' });
    const qy = z.object({ layout: z.enum(['classico', 'moderno', 'minimal']).optional(), headline: z.enum(['imobiliaria', 'corretor']).optional() }).parse(req.query);
    const [org, usr, logo] = await Promise.all([q1<any>('SELECT slug,name,brand,public_name FROM organizations WHERE id=$1', [req.user!.orgId]), q1<any>('SELECT name,email,card_profile FROM users WHERE id=$1', [req.user!.id]), loadLogo(req.user!.orgId)]);
    const brand: Brand = brandOf(org.brand); const cp = usr.card_profile ?? {};
    const svg = renderCard(m[1] as 'front' | 'back', qy.layout ?? brand.card_layout, {
      orgName: org.public_name || org.name, brand, logo: logo ? `data:image/png;base64,${logo.toString('base64')}` : null, name: usr.name, title: cp.title,
      phone: cp.phone ? phoneFmt(cp.phone) : undefined, whatsapp: cp.whatsapp ? phoneFmt(cp.whatsapp) : undefined, email: cp.card_email || usr.email, creci: cp.creci, url: vitrineUrl(org.slug, 'cartao'), services: brand.services, headline: qy.headline ?? cp.headline ?? 'imobiliaria',
    });
    reply.header('cache-control', 'private, no-store');
    if (m[2] === 'svg') return reply.type('image/svg+xml').send(svg);
    return reply.type('image/png').send(await sharp(Buffer.from(svg)).png().toBuffer());
  });
}
