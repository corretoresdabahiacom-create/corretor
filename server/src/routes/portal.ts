import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { z } from 'zod';
import { q, q1, tx } from '../db/pool.js';
import { audit, requirePerm } from '../lib/auth.js';
import { config } from '../lib/config.js';
import { isValidPhone, normalizePhone } from '../lib/validators.js';
import { limitProblem, usage } from '../lib/plans.js';
import { storage } from '../lib/storage.js';
import sharp from 'sharp';
const thumbs = new Map<string, Buffer>(); // cache simples em memória das miniaturas

const rl = (max: number, timeWindow: string) => ({ config: { rateLimit: process.env.RATE_LIMIT_DISABLED === 'true' ? false : { max, timeWindow } } });
export const CONSENT_TEXT = 'Autorizo que a imobiliária use meus dados de contato para responder a este interesse no imóvel.';
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const brl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(n);
const sign = (v: string) => crypto.createHmac('sha256', config.formSecret || 'x').update(v).digest('hex');
export const formToken = (code: string) => { const ts = Date.now(); return `${ts}.${sign(`${code}.${ts}`)}`; };
export function tokenOk(code: string, token: string) {
  const [ts, sig] = String(token).split('.');
  const age = Date.now() - Number(ts);
  if (!sig || !(age >= 3000 && age <= 2 * 3600_000)) return false; // rápido demais = robô; velho demais = expirado
  const exp = sign(`${code}.${ts}`);
  return exp.length === sig.length && crypto.timingSafeEqual(Buffer.from(exp), Buffer.from(sig));
}
const newCode = () => { const A = 'abcdefghjkmnpqrstuvwxyz23456789'; return Array.from(crypto.randomBytes(8), (b) => A[b % A.length]).join(''); };
export const bump = (orgId: string, propertyId: string, event: 'view' | 'share' | 'lead', channel = '') =>
  q(`INSERT INTO portal_stats(property_id,org_id,day,event,channel,n) VALUES ($1,$2,CURRENT_DATE,$3,$4,1) ON CONFLICT (property_id,day,event,channel) DO UPDATE SET n=portal_stats.n+1`, [propertyId, orgId, event, channel]);

export async function loadPublic(code: string) {
  if (!/^[a-z0-9]{6,12}$/.test(code)) return null;
  const p = await q1<any>(
    `SELECT p.*, o.name AS org_name, o.slug AS org_slug, o.public_name, o.public_whatsapp, o.public_badge, o.plan
       FROM properties p JOIN organizations o ON o.id=p.org_id WHERE p.public_code=$1 AND p.published_at IS NOT NULL AND p.status<>'arquivado'`, [code]);
  if (!p) return null;
  const photos = await q<any>(`SELECT id,caption,is_cover FROM files WHERE property_id=$1 AND category='foto' AND visibility='publico' ORDER BY is_cover DESC, position LIMIT 40`, [p.id]);
  const rd = p.rural_details ?? {}; const cd = p.coastal_details ?? {};
  return {
    code: p.public_code, title: p.title, description: p.description, kind: p.kind, subtype: p.subtype, purposes: p.purposes, status: p.status,
    city: p.city, state: p.state, neighborhood: p.neighborhood,
    street: p.show_exact_location ? p.address?.logradouro ?? null : null,
    latitude: p.show_exact_location ? p.latitude : null, longitude: p.show_exact_location ? p.longitude : null,
    prices: p.show_price ? { venda: p.price_sale, aluguel: p.price_rent, arrendamento: p.price_lease } : null,
    area_total: p.area_total, area_unit: p.area_unit, bedrooms: p.bedrooms, bathrooms: p.bathrooms, parking: p.parking, features: p.features ?? [],
    rural: p.kind === 'rural' ? { water_sources: rd.water_sources ?? [], activities: rd.activities ?? [] } : null, // registro declarado NÃO é público
    coastal: (p.location_tags ?? []).includes('litoral') ? { beach_distance_m: cd.beach_distance_m ?? null, sea_view: !!cd.sea_view } : null,
    videos: Array.isArray(p.videos) ? p.videos : [], org_slug: p.org_slug,
    photos: photos.map((f) => ({ id: f.id, caption: f.caption, url: `/api/public/files/${f.id}` })),
    agency: { name: p.public_name || p.org_name, whatsapp: p.public_whatsapp, badge: p.public_badge || p.plan === 'gratuito', slug: p.org_slug },
    _id: p.id, _org: p.org_id,
  };
}
const LABEL: Record<string, string> = { venda: 'Venda', aluguel: 'Aluguel', arrendamento: 'Arrendamento', temporada: 'Temporada', urbano: 'Urbano', rural: 'Rural' };

function renderPage(d: NonNullable<Awaited<ReturnType<typeof loadPublic>>>) {
  const base = config.publicOrigin.replace(/\/$/, '');
  const url = `${base}/p/${d.code}`;
  const place = [d.neighborhood, d.city && `${d.city}${d.state ? '/' + d.state : ''}`].filter(Boolean).join(' · ');
  const desc = (d.description || `${d.title} — ${place}`).replace(/\s+/g, ' ').slice(0, 160);
  const img = d.photos[0] ? `${base}${d.photos[0].url}` : '';
  const prices = d.prices ? Object.entries(d.prices).filter(([, v]) => v != null).map(([k, v]) => `<div class="price"><small>${esc(LABEL[k] ?? k)}</small> ${brl(v as number)}</div>`).join('') : '<div class="price"><small>Valor sob consulta</small></div>';
  const wa = d.agency.whatsapp ? `https://wa.me/55${normalizePhone(d.agency.whatsapp).replace(/^55/, '')}?text=${encodeURIComponent(`Olá! Tenho interesse no imóvel "${d.title}" (${url})`)}` : '';
  const facts = [d.area_total && `${d.area_total} ${d.area_unit === 'm2' ? 'm²' : d.area_unit === 'ha' ? 'ha' : 'alqueire(s)'}`, d.bedrooms != null && `${d.bedrooms} quartos`, d.bathrooms != null && `${d.bathrooms} banheiros`, d.parking != null && `${d.parking} vagas`].filter(Boolean);
  const token = formToken(d.code);
  const ld = { '@context': 'https://schema.org', '@type': 'RealEstateListing', name: d.title, description: desc, url, ...(img ? { image: img } : {}) };
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(d.title)} — ${esc(d.agency.name)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(d.title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(url)}">${img ? `<meta property="og:image" content="${esc(img)}"><meta name="twitter:card" content="summary_large_image">` : ''}
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;color:#1f2937;background:#f8fafc}main{max-width:820px;margin:0 auto;padding:1rem}h1{font-size:1.5rem;margin:.5rem 0}.g{display:flex;gap:.5rem;overflow-x:auto;scroll-snap-type:x mandatory}.g img{height:260px;max-width:90%;border-radius:10px;scroll-snap-align:start;object-fit:cover}.price{font-size:1.4rem;font-weight:700;color:#0f766e}.price small{display:block;font-size:.8rem;font-weight:400;color:#6b7280}.chip{display:inline-block;background:#e0f2f1;border-radius:99px;padding:.1rem .6rem;margin:.1rem;font-size:.85rem}.card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:1rem;margin:.8rem 0}label{display:block;margin:.5rem 0 .15rem;font-size:.9rem}input,textarea{width:100%;box-sizing:border-box;padding:.6rem;border:1px solid #cbd5e1;border-radius:8px;font:inherit}button,.btn{background:#0f766e;color:#fff;border:0;border-radius:8px;padding:.7rem 1rem;font:inherit;cursor:pointer;text-decoration:none;display:inline-block;margin-top:.6rem}.hp{position:absolute;left:-9999px}.warn{background:#fef3c7;padding:.5rem;border-radius:8px}footer{text-align:center;font-size:.8rem;color:#6b7280;padding:1rem}</style></head><body><main>
${d.photos.length ? `<div class="g">${d.photos.map((f) => `<img src="${esc(f.url)}" alt="${esc(f.caption || d.title)}" loading="lazy">`).join('')}</div>` : ''}
<h1>${esc(d.title)}</h1><div>${d.purposes.map((p: string) => `<span class="chip">${esc(LABEL[p] ?? p)}</span>`).join('')}<span class="chip">${esc(LABEL[d.kind] ?? d.kind)}</span></div>
${d.status !== 'disponivel' ? `<p class="warn">Este imóvel pode não estar mais disponível. Fale com a imobiliária para confirmar.</p>` : ''}
<div class="card">${prices}<p>${esc(place)}${d.street ? ` — ${esc(d.street)}` : ''}</p>${facts.length ? `<p>${esc(facts.join(' · '))}</p>` : ''}</div>
${d.description ? `<div class="card"><p style="white-space:pre-wrap;margin:0">${esc(d.description)}</p></div>` : ''}
${d.features.length ? `<div class="card">${d.features.map((f: string) => `<span class="chip">${esc(f)}</span>`).join('')}</div>` : ''}
${d.rural && (d.rural.water_sources.length || d.rural.activities.length) ? `<div class="card">${d.rural.water_sources.length ? `<p>Água: ${esc(d.rural.water_sources.join(', '))}</p>` : ''}${d.rural.activities.length ? `<p>Atividades: ${esc(d.rural.activities.join(', '))}</p>` : ''}</div>` : ''}
${d.coastal?.beach_distance_m != null ? `<div class="card">🌊 A ${esc(d.coastal.beach_distance_m)} m da praia${d.coastal.sea_view ? ' · vista para o mar' : ''}</div>` : ''}
<div class="card"><h2 style="margin-top:0">Tenho interesse</h2><p class="small">${esc(d.agency.name)}</p>
${wa ? `<a class="btn" href="${esc(wa)}" rel="noopener">Falar no WhatsApp</a>` : ''}
<form id="f" novalidate><label>Seu nome<input name="name" required maxlength="120" autocomplete="name"></label><label>Telefone com DDD<input name="phone" inputmode="tel" autocomplete="tel"></label><label>E-mail<input name="email" type="email" autocomplete="email"></label><label>Mensagem (opcional)<textarea name="message" rows="3" maxlength="1000"></textarea></label>
<div class="hp" aria-hidden="true"><label>Site<input name="website" tabindex="-1" autocomplete="off"></label></div>
<label style="display:flex;gap:.5rem;align-items:flex-start"><input type="checkbox" name="consent" style="width:auto;margin-top:.3rem"> <span>${esc(CONSENT_TEXT)}</span></label>
${config.turnstileSiteKey ? `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script><div class="cf-turnstile" data-sitekey="${esc(config.turnstileSiteKey)}"></div>` : ''}<button type="submit">Enviar</button><p id="m" role="status"></p></form></div>
${d.agency.badge ? `<footer>Feito com <a href="${esc(base)}/cadastrar?ref=${esc(d.agency.slug)}">ImobFlow</a> — organize seus imóveis e clientes grátis</footer>` : ''}
</main><script>
var f=document.getElementById('f'),m=document.getElementById('m'),t=${JSON.stringify(token)},c=${JSON.stringify(d.code)};
f.addEventListener('submit',function(e){e.preventDefault();var v=Object.fromEntries(new FormData(f));
 if(!v.name||v.name.trim().length<2){m.textContent='Informe seu nome.';return}
 if(!v.phone&&!v.email){m.textContent='Informe telefone ou e-mail para retornarmos.';return}
 if(!f.consent.checked){m.textContent='Marque a autorização para enviarmos seu contato.';return}
 m.textContent='Enviando…';
 fetch('/api/public/leads',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:c,token:t,name:v.name,phone:v.phone||undefined,email:v.email||undefined,message:v.message||undefined,website:v.website||'',cf_token:v['cf-turnstile-response']||undefined,consent:true,ref:new URLSearchParams(location.search).get('ref')||undefined})})
 .then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'Erro');m.textContent='Recebemos seu contato! Em breve retornaremos.';f.reset();})})
 .catch(function(e){m.textContent=e.message||'Não foi possível enviar. Tente de novo.'})});
</script></body></html>`;
}

export async function portalRoutes(app: FastifyInstance) {
  // ---------- público (sem login) ----------
  app.get('/p/:code', rl(120, '1 minute'), async (req, reply) => {
    const d = await loadPublic(String((req.params as any).code));
    if (!d) return reply.code(404).type('text/html').send('<!doctype html><meta charset="utf-8"><title>Imóvel não encontrado</title><p style="font:16px system-ui;padding:2rem">Este anúncio não está mais disponível.</p>');
    if (!/bot|crawl|spider|preview|facebookexternalhit|whatsapp|slack|telegram/i.test(String(req.headers['user-agent'] ?? ''))) await bump(d._org, d._id, 'view');
    return reply.header('cache-control', 'public, max-age=60').header('referrer-policy', 'strict-origin-when-cross-origin').type('text/html; charset=utf-8').send(renderPage(d));
  });

  app.get('/api/public/p/:code', rl(120, '1 minute'), async (req, reply) => {
    const d = await loadPublic(String((req.params as any).code));
    if (!d) return reply.code(404).send({ error: 'Anúncio não encontrado.' });
    const { _id, _org, ...pub } = d; return pub;
  });

  app.get('/api/public/files/:id', rl(300, '1 minute'), async (req, reply) => {
    const id = z.string().uuid().safeParse((req.params as any).id);
    const f = id.success ? await q1<any>(`SELECT f.* FROM files f JOIN properties p ON p.id=f.property_id WHERE f.id=$1 AND f.category='foto' AND f.visibility='publico' AND p.published_at IS NOT NULL AND p.status<>'arquivado'`, [id.data]) : null;
    if (!f) return reply.code(404).send({ error: 'Arquivo não encontrado.' });
    const w = Number((req.query as any).w);
    const data = await storage().get(f.storage_key);
    if (Number.isInteger(w) && w >= 64 && w <= 1600) {
      const ck = `${f.id}:${w}`; let out = thumbs.get(ck);
      if (!out) { out = await sharp(data).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer().catch(() => undefined); if (out) { thumbs.set(ck, out); if (thumbs.size > 200) thumbs.delete(thumbs.keys().next().value!); } }
      if (out) return reply.header('content-type', 'image/webp').header('cache-control', 'public, max-age=86400').header('x-content-type-options', 'nosniff').send(out);
    }
    return reply.header('content-type', f.mime).header('cache-control', 'public, max-age=3600').header('x-content-type-options', 'nosniff').send(data);
  });

  app.post('/api/public/leads', rl(5, '1 hour'), async (req, reply) => {
    const b = z.object({
      code: z.string().regex(/^[a-z0-9]{6,12}$/), token: z.string().max(200), name: z.string().trim().min(2, 'Informe seu nome.').max(120),
      phone: z.string().trim().max(30).optional(), email: z.string().trim().toLowerCase().email('E-mail inválido.').max(200).optional(),
      message: z.string().trim().max(1000).optional(), consent: z.literal(true, { message: 'É preciso autorizar o contato.' }),
      website: z.string().max(200).default(''), ref: z.string().max(80).optional(), cf_token: z.string().max(2048).optional(),
    }).parse(req.body);
    if (b.website) return reply.code(201).send({ ok: true }); // honeypot: finge sucesso, não grava
    if (!tokenOk(b.code, b.token)) return reply.code(400).send({ error: 'Formulário expirado. Recarregue a página e tente de novo.' });
    if (!b.phone && !b.email) return reply.code(400).send({ error: 'Informe telefone ou e-mail para retornarmos.' });
    if (b.phone && !isValidPhone(b.phone)) return reply.code(400).send({ error: 'Telefone inválido. Use DDD + número.' });
    if (config.turnstileSecret) {
      const ok = b.cf_token && (await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: new URLSearchParams({ secret: config.turnstileSecret, response: b.cf_token }) }).then((r) => r.json() as Promise<any>).then((j) => j.success).catch(() => false));
      if (!ok) return reply.code(400).send({ error: 'Não foi possível validar que você é uma pessoa. Tente novamente.' });
    }
    const p = await q1<any>(`SELECT id,org_id FROM properties WHERE public_code=$1 AND published_at IS NOT NULL AND status<>'arquivado'`, [b.code]);
    if (!p) return reply.code(404).send({ error: 'Anúncio não encontrado.' });
    const phone = b.phone ? normalizePhone(b.phone) : null;
    const dup = await q1(`SELECT 1 FROM portal_leads WHERE property_id=$1 AND created_at > now() - interval '24 hours' AND ((phone IS NOT NULL AND phone=$2) OR (email IS NOT NULL AND email=$3))`, [p.id, phone, b.email ?? null]);
    if (!dup) {
      await q(`INSERT INTO portal_leads(org_id,property_id,name,phone,email,message,consent_text,ref,ip_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [p.org_id, p.id, b.name, phone, b.email ?? null, b.message ?? null, CONSENT_TEXT, b.ref ?? null, crypto.createHash('sha256').update(req.ip + config.formSecret).digest('hex').slice(0, 24)]);
      await bump(p.org_id, p.id, 'lead');
    }
    return reply.code(201).send({ ok: true });
  });

  // Pedido de avaliação de imóvel pela vitrine pública (mesmas proteções do formulário de interesse).
  app.post('/api/public/vitrine/:slug/avaliacao', rl(5, '1 hour'), async (req, reply) => {
    const slug = String((req.params as any).slug);
    const b = z.object({
      token: z.string().max(200), name: z.string().trim().min(2, 'Informe seu nome.').max(120),
      phone: z.string().trim().max(30).optional(), email: z.string().trim().toLowerCase().email('E-mail inválido.').max(200).optional(),
      property_type: z.enum(['casa', 'apartamento', 'terreno', 'rural', 'comercial', 'outro']), address: z.string().trim().min(3, 'Informe o bairro e a cidade do imóvel.').max(200),
      message: z.string().trim().max(1000).optional(), consent: z.literal(true, { message: 'É preciso autorizar o contato.' }), website: z.string().max(200).default(''),
    }).parse(req.body);
    if (b.website) return reply.code(201).send({ ok: true });
    if (!tokenOk(`v:${slug}`, b.token)) return reply.code(400).send({ error: 'Formulário expirado. Recarregue a página e tente de novo.' });
    if (!b.phone && !b.email) return reply.code(400).send({ error: 'Informe telefone ou e-mail para retornarmos.' });
    if (b.phone && !isValidPhone(b.phone)) return reply.code(400).send({ error: 'Telefone inválido. Use DDD + número.' });
    const org = await q1<any>('SELECT id FROM organizations WHERE slug=$1', [slug]);
    if (!org) return reply.code(404).send({ error: 'Vitrine não encontrada.' });
    const phone = b.phone ? normalizePhone(b.phone) : null;
    const dup = await q1(`SELECT 1 FROM portal_leads WHERE org_id=$1 AND kind='avaliacao' AND created_at > now() - interval '24 hours' AND ((phone IS NOT NULL AND phone=$2) OR (email IS NOT NULL AND email=$3))`, [org.id, phone, b.email ?? null]);
    if (!dup) await q(`INSERT INTO portal_leads(org_id,property_id,kind,details,name,phone,email,message,consent_text,ref,ip_hash) VALUES ($1,NULL,'avaliacao',$2,$3,$4,$5,$6,$7,'vitrine',$8)`,
      [org.id, JSON.stringify({ property_type: b.property_type, address: b.address }), b.name, phone, b.email ?? null, b.message ?? null, CONSENT_TEXT, crypto.createHash('sha256').update(req.ip + config.formSecret).digest('hex').slice(0, 24)]);
    return reply.code(201).send({ ok: true });
  });

  // ---------- internos (com login) ----------
  const propId = (req: any) => z.string().uuid().parse(req.params.id);
  const mine = (orgId: string, id: string) => q1<any>('SELECT * FROM properties WHERE id=$1 AND org_id=$2', [id, orgId]);
  const urlOf = (code: string) => `${config.publicOrigin.replace(/\/$/, '')}/p/${code}`;

  app.post('/api/properties/:id/publish', { preHandler: requirePerm('properties.write') }, async (req, reply) => {
    const p = await mine(req.user!.orgId, propId(req));
    if (!p) return reply.code(404).send({ error: 'Imóvel não encontrado.' });
    if (!p.publish_authorized) return reply.code(400).send({ error: 'Registre a autorização do proprietário para divulgar antes de publicar.' });
    if (p.status !== 'disponivel') return reply.code(400).send({ error: 'Só imóveis disponíveis podem ser publicados.' });
    if (!p.published_at) {
      const lim = await limitProblem(req.user!.orgId, 'published');
      if (lim) return reply.code(402).send({ error: lim, code: 'PLAN_LIMIT' });
    }
    const code = p.public_code ?? newCode();
    await q('UPDATE properties SET public_code=$3, published_at=COALESCE(published_at,now()) WHERE id=$1 AND org_id=$2', [p.id, req.user!.orgId, code]);
    await audit(req, 'property.publish', 'property', p.id);
    return { published: true, code, url: urlOf(code) };
  });

  app.post('/api/properties/:id/unpublish', { preHandler: requirePerm('properties.write') }, async (req, reply) => {
    const p = await mine(req.user!.orgId, propId(req));
    if (!p) return reply.code(404).send({ error: 'Imóvel não encontrado.' });
    await q('UPDATE properties SET published_at=NULL WHERE id=$1 AND org_id=$2', [p.id, req.user!.orgId]);
    await audit(req, 'property.unpublish', 'property', p.id);
    return { published: false };
  });

  app.get('/api/properties/:id/portal', { preHandler: requirePerm('properties.read') }, async (req, reply) => {
    const p = await mine(req.user!.orgId, propId(req));
    if (!p) return reply.code(404).send({ error: 'Imóvel não encontrado.' });
    const st = await q<any>(`SELECT event, sum(n)::int n FROM portal_stats WHERE property_id=$1 AND day > CURRENT_DATE - 30 GROUP BY event`, [p.id]);
    const get = (e: string) => st.find((r) => r.event === e)?.n ?? 0;
    const pub = await q1<any>(`SELECT count(*)::int n FROM files WHERE property_id=$1 AND category='foto' AND visibility='publico'`, [p.id]);
    return { published: !!p.published_at, featured: !!p.featured, url: p.published_at ? urlOf(p.public_code) : null, authorized: p.publish_authorized, public_photos: pub?.n ?? 0, last_30_days: { views: get('view'), shares: get('share'), leads: get('lead') } };
  });

  app.post('/api/properties/:id/share', { preHandler: requirePerm('properties.read') }, async (req, reply) => {
    const { channel } = z.object({ channel: z.enum(['whatsapp', 'link', 'instagram', 'email']) }).parse(req.body);
    const p = await mine(req.user!.orgId, propId(req));
    if (!p) return reply.code(404).send({ error: 'Imóvel não encontrado.' });
    if (!p.published_at) return reply.code(400).send({ error: 'Publique o imóvel antes de compartilhar.' });
    await bump(req.user!.orgId, p.id, 'share', channel);
    const url = urlOf(p.public_code);
    return { url, whatsapp_url: `https://wa.me/?text=${encodeURIComponent(`${p.title}\n${url}`)}` };
  });

  app.get('/api/leads', { preHandler: requirePerm('people.read') }, async (req) => {
    const { status } = z.object({ status: z.enum(['novo', 'convertido', 'descartado']).optional() }).parse(req.query);
    return q(`SELECT l.id,l.name,l.phone,l.email,l.message,l.status,l.person_id,l.created_at,l.ref,l.kind,l.details,p.id AS property_id,p.code AS property_code,p.title AS property_title
      FROM portal_leads l LEFT JOIN properties p ON p.id=l.property_id WHERE l.org_id=$1 AND ($2::text IS NULL OR l.status=$2) ORDER BY l.created_at DESC LIMIT 200`, [req.user!.orgId, status ?? null]);
  });

  app.post('/api/leads/:id/convert', { preHandler: requirePerm('people.write') }, async (req, reply) => {
    const id = propId(req);
    const out = await tx(async (c) => {
      const l = (await c.query('SELECT l.*, p.broker_user_id, p.title FROM portal_leads l LEFT JOIN properties p ON p.id=l.property_id WHERE l.id=$1 AND l.org_id=$2 FOR UPDATE OF l', [id, req.user!.orgId])).rows[0];
      if (!l) return { code: 404, error: 'Contato não encontrado.' };
      if (l.status !== 'novo') return { code: 409, error: 'Este contato já foi tratado.' };
      let person = (await c.query(`SELECT id FROM people WHERE org_id=$1 AND archived_at IS NULL AND (($2::text IS NOT NULL AND phones @> ARRAY[$2]::text[]) OR ($3::text IS NOT NULL AND emails @> ARRAY[$3]::text[])) LIMIT 1`, [req.user!.orgId, l.phone, l.email])).rows[0];
      const existing = !!person;
      if (!person) {
        person = (await c.query(
          `INSERT INTO people(org_id,kind,name,phones,emails,source,consent,owner_user_id,created_by,updated_by) VALUES ($1,'fisica',$2,$3,$4,'portal',$5,$6,$7,$7) RETURNING id`,
          [req.user!.orgId, l.name, l.phone ? [l.phone] : [], l.email ? [l.email] : [], JSON.stringify({ contact_ok: true, via: 'portal', text: l.consent_text, at: l.consent_at }), l.broker_user_id ?? req.user!.id, req.user!.id])).rows[0];
      }
      await c.query(`INSERT INTO person_interactions(org_id,person_id,type,body,user_id) VALUES ($1,$2,'nota',$3,$4)`, [req.user!.orgId, person.id, l.kind === 'avaliacao' ? `Pediu avaliação de imóvel pela vitrine (${[l.details?.property_type, l.details?.address].filter(Boolean).join(' — ') || 'sem detalhes'}).${l.message ? ` Mensagem: ${l.message}` : ''}` : `Interesse pelo portal no imóvel “${l.title}”.${l.message ? ` Mensagem: ${l.message}` : ''}`, req.user!.id]);
      await c.query(`UPDATE portal_leads SET status='convertido', person_id=$2, handled_by=$3, handled_at=now() WHERE id=$1`, [id, person.id, req.user!.id]);
      return { code: 200, person_id: person.id, existing };
    });
    if (out.code !== 200) return reply.code(out.code).send(out);
    await audit(req, 'lead.convert', 'lead', id);
    return out;
  });

  app.post('/api/leads/:id/discard', { preHandler: requirePerm('people.write') }, async (req, reply) => {
    const r = await q1(`UPDATE portal_leads SET status='descartado', handled_by=$3, handled_at=now() WHERE id=$1 AND org_id=$2 AND status='novo' RETURNING id`, [propId(req), req.user!.orgId, req.user!.id]);
    if (!r) return reply.code(404).send({ error: 'Contato não encontrado ou já tratado.' });
    return { ok: true };
  });

  app.get('/api/org/plan', { preHandler: requirePerm('properties.read') }, async (req) => {
    const u = await usage(req.user!.orgId);
    const o = await q1<any>('SELECT slug,public_name,public_whatsapp,public_badge FROM organizations WHERE id=$1', [req.user!.orgId]);
    return { ...u, profile: { public_name: o.public_name, public_whatsapp: o.public_whatsapp, public_badge: o.public_badge }, referral_link: `${config.publicOrigin.replace(/\/$/, '')}/cadastrar?ref=${o.slug}` };
  });

  app.patch('/api/org/public-profile', { preHandler: requirePerm('org.manage') }, async (req, reply) => {
    const b = z.object({ public_name: z.string().trim().max(80).nullable().optional(), public_whatsapp: z.string().trim().max(30).nullable().optional(), public_badge: z.boolean().optional() }).parse(req.body);
    if (b.public_whatsapp && !isValidPhone(b.public_whatsapp)) return reply.code(400).send({ error: 'WhatsApp inválido. Use DDD + número.' });
    const u = await usage(req.user!.orgId);
    if (b.public_badge === false && u.plan === 'gratuito') return reply.code(402).send({ error: 'No plano gratuito o selo “Feito com ImobFlow” permanece nas páginas públicas.', code: 'PLAN_LIMIT' });
    await q(`UPDATE organizations SET public_name=COALESCE($2,public_name), public_whatsapp=COALESCE($3,public_whatsapp), public_badge=COALESCE($4,public_badge) WHERE id=$1`,
      [req.user!.orgId, b.public_name === undefined ? null : b.public_name, b.public_whatsapp === undefined ? null : (b.public_whatsapp ? normalizePhone(b.public_whatsapp) : ''), b.public_badge ?? null]);
    return { ok: true };
  });

  // Métricas de aquisição — apenas contagens reais; "views" são carregamentos, não visitantes únicos.
  app.get('/api/growth', { preHandler: requirePerm('reports.read') }, async (req) => {
    const o = req.user!.orgId;
    const [tot, per, leads, refs] = await Promise.all([
      q<any>(`SELECT event, sum(n)::int n FROM portal_stats WHERE org_id=$1 AND day > CURRENT_DATE - 30 GROUP BY event`, [o]),
      q<any>(`SELECT p.id,p.code,p.title, COALESCE(sum(s.n) FILTER (WHERE s.event='view'),0)::int views, COALESCE(sum(s.n) FILTER (WHERE s.event='share'),0)::int shares, COALESCE(sum(s.n) FILTER (WHERE s.event='lead'),0)::int leads
              FROM properties p LEFT JOIN portal_stats s ON s.property_id=p.id AND s.day > CURRENT_DATE - 30 WHERE p.org_id=$1 AND p.published_at IS NOT NULL GROUP BY p.id ORDER BY 6 DESC, 4 DESC LIMIT 20`, [o]),
      q1<any>(`SELECT count(*)::int total, count(*) FILTER (WHERE status='convertido')::int convertidos, count(*) FILTER (WHERE status='novo')::int novos FROM portal_leads WHERE org_id=$1 AND created_at > now() - interval '30 days'`, [o]),
      q1<any>(`SELECT count(*)::int n FROM organizations WHERE referred_by_org=$1`, [o]),
    ]);
    const g = (e: string) => tot.find((r) => r.event === e)?.n ?? 0;
    const vit = await q<any>(`SELECT source, sum(n)::int n FROM vitrine_stats WHERE org_id=$1 AND day > CURRENT_DATE - 30 GROUP BY source`, [o]);
    const vg = (k: string) => vit.find((r) => r.source === k)?.n ?? 0;
    return { vitrine_last_30_days: { link: vg('link'), qr: vg('qr'), cartao: vg('cartao') }, last_30_days: { views: g('view'), shares: g('share'), leads: leads.total, leads_converted: leads.convertidos, leads_new: leads.novos }, properties: per, referred_agencies: refs?.n ?? 0,
      note: 'Visualizações contam carregamentos da página (sem robôs conhecidos), não visitantes únicos.' };
  });
}
