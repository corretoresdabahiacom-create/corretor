// Engajamento: mensagem pronta de WhatsApp (painel) e alertas de novos imóveis (vitrine pública + painel).
import type { FastifyInstance } from '../http/mini.js';
import crypto from 'node:crypto';
import { z } from 'zod';
import { q, q1 } from '../db/pool.js';
import { audit, requirePerm } from '../lib/auth.js';
import { config } from '../lib/config.js';
import { isValidPhone, normalizePhone } from '../lib/validators.js';
import { alertMatches, whatsappMessage } from '../lib/engage.js';
import { CONSENT_TEXT, tokenOk } from './portal.js';

const rl = (max: number, timeWindow: string) => ({ config: { rateLimit: process.env.RATE_LIMIT_DISABLED === 'true' ? false : { max, timeWindow } } });
const base = () => config.publicOrigin.replace(/\/$/, '');
const ALERT_CONSENT = 'Autorizo receber avisos de novos imóveis por WhatsApp ou e-mail e o tratamento dos meus dados para esse fim. Posso pedir a exclusão a qualquer momento.';

export async function engageRoutes(app: FastifyInstance) {
  app.get('/api/properties/:id/whatsapp-message', { preHandler: requirePerm('properties.read') }, async (req, reply) => {
    const id = z.string().uuid().safeParse((req.params as any).id);
    const p = id.success ? await q1<any>('SELECT * FROM properties WHERE id=$1 AND org_id=$2', [id.data, req.user!.orgId]) : null;
    if (!p) return reply.code(404).send({ error: 'Imóvel não encontrado.' });
    const org = await q1<any>('SELECT slug, public_name, name FROM organizations WHERE id=$1', [req.user!.orgId]);
    const published = !!p.published_at && p.public_code;
    const link = published ? `${base()}/v/${org.slug}/imovel/${p.public_code}` : null;
    const purpose = typeof (req.query as any).purpose === 'string' ? (req.query as any).purpose : undefined;
    return {
      text: whatsappMessage(p, link, purpose, org.public_name || org.name), link, published,
      note: published ? null : 'O imóvel não está publicado: a mensagem sai sem link. Publique para incluir a página com fotos.',
    };
  });

  // ---------- público: pedir aviso de novos imóveis ----------
  app.post('/api/public/vitrine/:slug/alertas', rl(5, '1 hour'), async (req, reply) => {
    const slug = String((req.params as any).slug);
    const b = z.object({
      token: z.string().max(200), name: z.string().trim().min(2, 'Informe seu nome.').max(120),
      phone: z.string().trim().max(30).optional(), email: z.string().trim().toLowerCase().email('E-mail inválido.').max(200).optional(),
      purpose: z.enum(['venda', 'aluguel', 'temporada', 'arrendamento']).optional(), kind: z.enum(['urbano', 'rural']).optional(),
      city: z.string().trim().max(80).optional(), max_price: z.number().positive().max(1e10).optional(), min_bedrooms: z.number().int().min(0).max(20).optional(),
      consent: z.literal(true, { message: 'É preciso autorizar o contato.' }), website: z.string().max(200).default(''),
    }).parse(req.body);
    if (b.website) return reply.code(201).send({ ok: true });
    if (!tokenOk(`v:${slug}`, b.token)) return reply.code(400).send({ error: 'Formulário expirado. Recarregue a página e tente de novo.' });
    if (!b.phone && !b.email) return reply.code(400).send({ error: 'Informe telefone ou e-mail para receber os avisos.' });
    if (b.phone && !isValidPhone(b.phone)) return reply.code(400).send({ error: 'Telefone inválido. Use DDD + número.' });
    const org = await q1<any>('SELECT id FROM organizations WHERE slug=$1', [slug]);
    if (!org) return reply.code(404).send({ error: 'Vitrine não encontrada.' });
    const phone = b.phone ? normalizePhone(b.phone) : null;
    const dup = await q1(`SELECT 1 FROM property_alerts WHERE org_id=$1 AND ((phone IS NOT NULL AND phone=$2) OR (email IS NOT NULL AND email=$3)) AND coalesce(purpose,'')=$4 AND coalesce(lower(city),'')=$5 AND coalesce(kind,'')=$6`,
      [org.id, phone, b.email ?? null, b.purpose ?? '', (b.city ?? '').toLowerCase(), b.kind ?? '']);
    const n = await q1<{ n: number }>(`SELECT count(*)::int n FROM property_alerts WHERE org_id=$1`, [org.id]);
    if (!dup && (n?.n ?? 0) < 5000)
      await q(`INSERT INTO property_alerts(org_id,name,phone,email,purpose,kind,city,max_price,min_bedrooms,consent_text,ip_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [org.id, b.name, phone, b.email ?? null, b.purpose ?? null, b.kind ?? null, b.city || null, b.max_price ?? null, b.min_bedrooms ?? null, ALERT_CONSENT, crypto.createHash('sha256').update(req.ip + config.formSecret).digest('hex').slice(0, 24)]);
    return reply.code(201).send({ ok: true });
  });

  // ---------- painel ----------
  app.get('/api/property-alerts', { preHandler: requirePerm('people.read') }, async (req) => {
    const org = req.user!.orgId;
    const alerts = await q<any>(`SELECT * FROM property_alerts WHERE org_id=$1 ORDER BY status, created_at DESC LIMIT 300`, [org]);
    const props = await q<any>(`SELECT id,title,kind,subtype,purposes,city,state,neighborhood,price_sale,price_rent,price_lease,show_price,bedrooms,bathrooms,parking,area_total,area_unit,location_tags,coastal_details,public_code,published_at
      FROM properties WHERE org_id=$1 AND published_at IS NOT NULL AND status='disponivel' AND published_at > now() - interval '90 days'`, [org]);
    const o = await q1<any>('SELECT slug, public_name, name FROM organizations WHERE id=$1', [org]);
    return alerts.map((a) => {
      const since = new Date(a.last_notified_at ?? a.created_at).getTime();
      const matches = a.status !== 'ativo' ? [] : props.filter((p) => new Date(p.published_at).getTime() > since && alertMatches(a, p)).map((p) => {
        const link = `${base()}/v/${o.slug}/imovel/${p.public_code}`;
        return { id: p.id, title: p.title, link, text: `Olá, ${String(a.name).split(' ')[0]}! Chegou um imóvel que combina com o que você procura:\n\n${whatsappMessage(p, link, a.purpose ?? undefined, o.public_name || o.name)}` };
      });
      const { ip_hash, ...rest } = a;
      return { ...rest, new_matches: matches };
    });
  });
  app.post('/api/property-alerts/:id/notified', { preHandler: requirePerm('people.write') }, async (req, reply) => {
    const id = z.string().uuid().parse((req.params as any).id);
    const r = await q('UPDATE property_alerts SET last_notified_at=now() WHERE id=$1 AND org_id=$2 RETURNING id', [id, req.user!.orgId]);
    if (!r.length) return reply.code(404).send({ error: 'Pedido não encontrado.' });
    await audit(req, 'alert.notified', 'property_alert', id);
    return { ok: true };
  });
  app.patch('/api/property-alerts/:id', { preHandler: requirePerm('people.write') }, async (req, reply) => {
    const id = z.string().uuid().parse((req.params as any).id); const b = z.object({ status: z.enum(['ativo', 'pausado']) }).parse(req.body);
    const r = await q('UPDATE property_alerts SET status=$3 WHERE id=$1 AND org_id=$2 RETURNING id', [id, req.user!.orgId, b.status]);
    return r.length ? { ok: true } : reply.code(404).send({ error: 'Pedido não encontrado.' });
  });
  app.delete('/api/property-alerts/:id', { preHandler: requirePerm('people.write') }, async (req, reply) => {
    const id = z.string().uuid().parse((req.params as any).id);
    const r = await q('DELETE FROM property_alerts WHERE id=$1 AND org_id=$2 RETURNING id', [id, req.user!.orgId]);
    if (!r.length) return reply.code(404).send({ error: 'Pedido não encontrado.' });
    await audit(req, 'alert.delete', 'property_alert', id);
    return { ok: true };
  });
}
export { ALERT_CONSENT, CONSENT_TEXT };
