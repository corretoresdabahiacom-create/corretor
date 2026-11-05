import type { FastifyInstance } from 'fastify';
import { limitProblem } from '../lib/plans.js';
import { z } from 'zod';
import { q, q1, tx } from '../db/pool.js';
import { audit, requirePerm } from '../lib/auth.js';
import { can } from '../lib/permissions.js';

export const URBAN_SUBTYPES = ['casa', 'apartamento', 'cobertura', 'kitnet', 'terreno', 'sala_comercial', 'loja', 'galpao', 'predio', 'outro'];
export const RURAL_SUBTYPES = ['fazenda', 'sitio', 'chacara', 'terreno_rural', 'propriedade_produtiva', 'outro'];
export const STATUSES = ['em_preparacao', 'disponivel', 'reservado', 'em_negociacao', 'vendido', 'alugado', 'arrendado', 'indisponivel', 'arquivado'] as const;
export const PURPOSES = ['venda', 'aluguel', 'temporada', 'arrendamento'] as const;

const ruralDetails = z
  .object({
    area_agricultable: z.number().nonnegative().optional(),
    area_pasture: z.number().nonnegative().optional(),
    area_reserve: z.number().nonnegative().optional(),
    area_built: z.number().nonnegative().optional(),
    water_sources: z.array(z.string()).optional(),
    energy: z.string().optional(),
    access: z.string().optional(),
    improvements: z.array(z.string()).optional(),
    activities: z.array(z.string()).optional(),
    visit_conditions: z.string().optional(),
    // Dados DECLARADOS pelo proprietário. O sistema não atesta regularidade fundiária/ambiental.
    registry: z
      .object({
        matricula: z.string().optional(), car: z.string().optional(), ccir: z.string().optional(),
        itr_nirf: z.string().optional(), incra_code: z.string().optional(), georreferenciado: z.boolean().optional(),
        verified: z.literal(false).default(false),
      })
      .partial()
      .optional(),
  })
  .passthrough();

const coastalDetails = z
  .object({
    beach_distance_m: z.number().nonnegative().optional(),
    beach_distance_source: z.enum(['informada', 'estimada', 'medida']).optional(),
    beach_access: z.string().optional(),
    sea_view: z.boolean().optional(),
    guests_capacity: z.number().int().nonnegative().optional(),
    beds: z.number().int().nonnegative().optional(),
    bedrooms: z.number().int().nonnegative().optional(),
    season_rules: z.string().optional(),
    cleaning_fee: z.number().nonnegative().optional(),
    season_prices: z.array(z.object({ label: z.string(), from: z.string(), to: z.string(), price_per_night: z.number().nonnegative() })).optional(),
    booking_conditions: z.string().optional(),
  })
  .passthrough();

const propertySchema = z
  .object({
    title: z.string().trim().min(3, 'Informe um título.'),
    description: z.string().optional().nullable(),
    kind: z.enum(['urbano', 'rural']),
    subtype: z.string().min(2),
    purposes: z.array(z.enum(PURPOSES)).min(1, 'Escolha ao menos uma finalidade.'),
    location_tags: z.array(z.string()).default([]),
    status: z.enum(STATUSES).default('em_preparacao'),
    address: z.record(z.string(), z.any()).default({}),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    price_sale: z.number().nonnegative().nullable().optional(),
    price_rent: z.number().nonnegative().nullable().optional(),
    price_lease: z.number().nonnegative().nullable().optional(),
    recurring_fees: z.record(z.string(), z.number()).default({}),
    area_total: z.number().nonnegative().nullable().optional(),
    area_built: z.number().nonnegative().nullable().optional(),
    area_unit: z.enum(['m2', 'ha', 'alqueire']).default('m2'),
    bedrooms: z.number().int().nonnegative().nullable().optional(),
    suites: z.number().int().nonnegative().nullable().optional(),
    bathrooms: z.number().int().nonnegative().nullable().optional(),
    parking: z.number().int().nonnegative().nullable().optional(),
    urban_details: z.record(z.string(), z.any()).default({}),
    rural_details: ruralDetails.default({}),
    coastal_details: coastalDetails.default({}),
    features: z.array(z.string()).default([]),
    owner_person_id: z.string().uuid().nullable().optional(),
    broker_user_id: z.string().uuid().nullable().optional(),
    captured_at: z.string().optional(),
    available_from: z.string().nullable().optional(),
    internal_notes: z.string().nullable().optional(),
    publish_authorized: z.boolean().default(false),
    show_exact_location: z.boolean().default(false),
    show_price: z.boolean().default(true),
  })
  .superRefine((p, ctx) => {
    const allowed = p.kind === 'urbano' ? URBAN_SUBTYPES : RURAL_SUBTYPES;
    if (!allowed.includes(p.subtype)) ctx.addIssue({ code: 'custom', path: ['subtype'], message: `Tipo inválido para imóvel ${p.kind}.` });
    if (p.purposes.includes('venda') && p.price_sale == null) ctx.addIssue({ code: 'custom', path: ['price_sale'], message: 'Informe o preço de venda.' });
    if (p.purposes.includes('aluguel') && p.price_rent == null) ctx.addIssue({ code: 'custom', path: ['price_rent'], message: 'Informe o valor do aluguel.' });
    if (p.purposes.includes('arrendamento') && p.price_lease == null) ctx.addIssue({ code: 'custom', path: ['price_lease'], message: 'Informe o valor do arrendamento.' });
    if (p.kind === 'urbano' && p.area_unit === 'alqueire') ctx.addIssue({ code: 'custom', path: ['area_unit'], message: 'Alqueire é usado em imóveis rurais.' });
    if (p.publish_authorized && p.status === 'em_preparacao') ctx.addIssue({ code: 'custom', path: ['publish_authorized'], message: 'Só é possível autorizar a divulgação de imóveis já preparados.' });
  });

export const HECTARE = { m2: 0.0001, ha: 1, alqueire: 2.42 }; // alqueire paulista (referência; varia por região)
export const toHectares = (v: number, u: 'm2' | 'ha' | 'alqueire') => v * HECTARE[u];

function stripInternal(p: any, role: any) {
  const out = { ...p };
  if (!can(role, 'properties.internal')) out.internal_notes = null;
  return out;
}

/** Pontuação explicável: compara o perfil de um comprador/interessado com um imóvel. */
export function matchScore(profile: any, p: any): { score: number; max: number; reasons: string[]; mismatches: string[] } {
  const reasons: string[] = [];
  const mismatches: string[] = [];
  let score = 0;
  let max = 0;
  const check = (weight: number, applicable: boolean, ok: boolean, yes: string, no: string) => {
    if (!applicable) return;
    max += weight;
    if (ok) { score += weight; reasons.push(yes); } else mismatches.push(no);
  };
  const pf = profile ?? {};
  const price = (purpose: string) => (purpose === 'venda' ? p.price_sale : purpose === 'aluguel' || purpose === 'temporada' ? p.price_rent : p.price_lease);

  if (pf.purposes?.length) {
    const hit = pf.purposes.find((x: string) => p.purposes.includes(x));
    check(25, true, !!hit, `Finalidade compatível (${hit})`, 'Finalidade diferente da procurada');
    if (pf.budget_max != null || pf.budget_min != null) {
      const v = price(hit ?? pf.purposes[0]);
      if (v != null) {
        const okMax = pf.budget_max == null || v <= pf.budget_max;
        const okMin = pf.budget_min == null || v >= pf.budget_min;
        check(25, true, okMax && okMin, 'Preço dentro do orçamento', pf.budget_max != null && v > pf.budget_max ? 'Acima do orçamento máximo' : 'Abaixo do orçamento mínimo');
      }
    }
  }
  if (pf.property_kinds?.length) check(15, true, pf.property_kinds.includes(p.subtype), `Tipo desejado (${p.subtype})`, 'Tipo de imóvel diferente');
  if (pf.regions?.length) {
    const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const hit = pf.regions.some((r: string) => [p.city, p.neighborhood].filter(Boolean).some((l: string) => norm(l).includes(norm(r)) || norm(r).includes(norm(l))));
    check(15, true, hit, 'Região preferida', 'Fora das regiões preferidas');
  }
  if (pf.location_tags?.length) check(10, true, pf.location_tags.some((t: string) => p.location_tags.includes(t)), 'Localização desejada (ex.: litoral)', 'Localização diferente da desejada');
  if (pf.bedrooms_min != null && p.bedrooms != null) check(5, true, p.bedrooms >= pf.bedrooms_min, 'Quartos suficientes', 'Menos quartos que o desejado');
  if (pf.bathrooms_min != null && p.bathrooms != null) check(3, true, p.bathrooms >= pf.bathrooms_min, 'Banheiros suficientes', 'Menos banheiros que o desejado');
  if (pf.parking_min != null && p.parking != null) check(3, true, p.parking >= pf.parking_min, 'Vagas suficientes', 'Menos vagas que o desejado');
  if (pf.area_min != null && p.area_total != null) {
    const unit = pf.area_unit ?? p.area_unit;
    const need = toHectares(pf.area_min, unit);
    check(8, true, toHectares(p.area_total, p.area_unit) >= need, 'Área mínima atendida', 'Área menor que a mínima');
  }
  if (pf.features?.length) {
    const have = pf.features.filter((f: string) => p.features.includes(f));
    check(6, true, have.length === pf.features.length, 'Todas as características desejadas', `Faltam características (${pf.features.filter((f: string) => !p.features.includes(f)).join(', ')})`);
  }
  return { score: max ? Math.round((score / max) * 100) : 0, max, reasons, mismatches };
}

export async function propertyRoutes(app: FastifyInstance) {
  app.get('/api/properties', { preHandler: requirePerm('properties.read') }, async (req) => {
    const f = z
      .object({
        q: z.string().optional(), kind: z.string().optional(), subtype: z.string().optional(), purpose: z.enum(PURPOSES).optional(),
        status: z.string().optional(), city: z.string().optional(), state: z.string().optional(), tag: z.string().optional(),
        price_min: z.coerce.number().optional(), price_max: z.coerce.number().optional(),
        area_min_ha: z.coerce.number().optional(), area_max_ha: z.coerce.number().optional(),
        bedrooms_min: z.coerce.number().optional(), feature: z.union([z.string(), z.array(z.string())]).optional(),
        favorites: z.enum(['true', 'false']).optional(), broker: z.string().uuid().optional(),
        sort: z.enum(['recent', 'price_asc', 'price_desc', 'relevance']).default('recent'),
        page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
      })
      .parse(req.query);
    const params: unknown[] = [req.user!.orgId];
    const where = ['p.org_id=$1'];
    const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
    if (f.status) add('p.status = ?', f.status); else where.push(`p.status <> 'arquivado'`);
    if (f.kind) add('p.kind = ?', f.kind);
    if (f.subtype) add('p.subtype = ?', f.subtype);
    if (f.purpose) add('? = ANY(p.purposes)', f.purpose);
    if (f.city) add('p.city ILIKE ?', `%${f.city}%`);
    if (f.state) add('p.state = ?', f.state.toUpperCase());
    if (f.tag) add('? = ANY(p.location_tags)', f.tag);
    if (f.broker) add('p.broker_user_id = ?', f.broker);
    if (f.bedrooms_min != null) add('p.bedrooms >= ?', f.bedrooms_min);
    const priceExpr = `coalesce(CASE WHEN $PURPOSE='aluguel' OR $PURPOSE='temporada' THEN p.price_rent WHEN $PURPOSE='arrendamento' THEN p.price_lease ELSE p.price_sale END, p.price_sale, p.price_rent, p.price_lease)`;
    // f.purpose é um enum validado (venda|aluguel|temporada|arrendamento): seguro para inserir como literal
    const price = priceExpr.replaceAll('$PURPOSE', `'${f.purpose ?? 'venda'}'`);
    if (f.price_min != null) add(`${price} >= ?`, f.price_min);
    if (f.price_max != null) add(`${price} <= ?`, f.price_max);
    const haExpr = `(p.area_total * CASE p.area_unit WHEN 'm2' THEN 0.0001 WHEN 'alqueire' THEN 2.42 ELSE 1 END)`;
    if (f.area_min_ha != null) add(`${haExpr} >= ?`, f.area_min_ha);
    if (f.area_max_ha != null) add(`${haExpr} <= ?`, f.area_max_ha);
    for (const ft of ([] as string[]).concat(f.feature ?? [])) add('? = ANY(p.features)', ft);
    if (f.favorites === 'true') { params.push(req.user!.id); where.push(`EXISTS (SELECT 1 FROM favorites fv WHERE fv.property_id=p.id AND fv.user_id=$${params.length})`); }
    let rank = 'p.updated_at';
    if (f.q) {
      params.push(f.q);
      const qi = params.length;
      where.push(`(p.code ILIKE '%'||$${qi}||'%' OR (coalesce(p.title,'')||' '||coalesce(p.description,'')||' '||coalesce(p.city,'')||' '||coalesce(p.neighborhood,'')) ILIKE '%'||$${qi}||'%')`);
      rank = `similarity(coalesce(p.title,'')||' '||coalesce(p.city,''), $${qi})`;
    }
    const order = f.sort === 'price_asc' ? `${price} ASC NULLS LAST` : f.sort === 'price_desc' ? `${price} DESC NULLS LAST` : f.sort === 'relevance' ? `${rank} DESC` : 'p.updated_at DESC';
    const total = (await q1(`SELECT count(*)::int n FROM properties p WHERE ${where.join(' AND ')}`, params)).n;
    params.push(f.pageSize, (f.page - 1) * f.pageSize);
    params.push(req.user!.id);
    const rows = await q(
      `SELECT p.*, ${price} AS display_price,
         (SELECT f.id FROM files f WHERE f.property_id=p.id AND f.category='foto' ORDER BY f.is_cover DESC, f.position, f.created_at LIMIT 1) AS cover_id,
         (SELECT count(*)::int FROM files f WHERE f.property_id=p.id AND f.category='foto') AS photo_count, EXISTS (SELECT 1 FROM favorites fv WHERE fv.property_id=p.id AND fv.user_id=$${params.length}) AS is_favorite
         FROM properties p WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT $${params.length - 2} OFFSET $${params.length - 1}`,
      params,
    );
    return { total, page: f.page, pageSize: f.pageSize, items: rows.map((r) => stripInternal(r, req.user!.role)) };
  });

  app.post('/api/properties', { preHandler: requirePerm('properties.write') }, async (req, reply) => {
    const b = propertySchema.parse(req.body);
    const lim = await limitProblem(req.user!.orgId, 'properties');
    if (lim) return reply.code(402).send({ error: lim, code: 'PLAN_LIMIT' });
    const p = await tx(async (c) => {
      if (b.owner_person_id && !(await c.query('SELECT 1 FROM people WHERE id=$1 AND org_id=$2', [b.owner_person_id, req.user!.orgId])).rowCount) {
        throw Object.assign(new Error('Proprietário não encontrado.'), { statusCode: 400 });
      }
      const org = (await c.query('UPDATE organizations SET property_seq=property_seq+1 WHERE id=$1 RETURNING property_seq, settings', [req.user!.orgId])).rows[0];
      const prefix = org.settings?.property_code_prefix ?? 'IMV';
      const code = `${prefix}-${String(org.property_seq).padStart(5, '0')}`;
      const ad = b.address as any;
      return (
        await c.query(
          `INSERT INTO properties(org_id,code,title,description,kind,subtype,purposes,location_tags,status,address,city,state,neighborhood,latitude,longitude,price_sale,price_rent,price_lease,recurring_fees,area_total,area_built,area_unit,bedrooms,suites,bathrooms,parking,urban_details,rural_details,coastal_details,features,owner_person_id,broker_user_id,captured_at,available_from,internal_notes,publish_authorized,show_exact_location,show_price,created_by,updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,coalesce($33::date,current_date),$34,$35,$36,$37,$38,$39,$39) RETURNING *`,
          [
            req.user!.orgId, code, b.title, b.description ?? null, b.kind, b.subtype, b.purposes, b.location_tags, b.status, JSON.stringify(b.address),
            ad.cidade ?? null, ad.uf ?? null, ad.bairro ?? null, b.latitude ?? null, b.longitude ?? null, b.price_sale ?? null, b.price_rent ?? null, b.price_lease ?? null,
            JSON.stringify(b.recurring_fees), b.area_total ?? null, b.area_built ?? null, b.area_unit, b.bedrooms ?? null, b.suites ?? null, b.bathrooms ?? null, b.parking ?? null,
            JSON.stringify(b.urban_details), JSON.stringify(b.rural_details), JSON.stringify(b.coastal_details), b.features, b.owner_person_id ?? null,
            b.broker_user_id ?? req.user!.id, b.captured_at ?? null, b.available_from ?? null, b.internal_notes ?? null, b.publish_authorized, b.show_exact_location, b.show_price, req.user!.id,
          ],
        )
      ).rows[0];
    });
    await audit(req, 'property.create', 'property', p.id, { code: p.code });
    return reply.code(201).send(stripInternal(p, req.user!.role));
  });

  app.get('/api/properties/:id', { preHandler: requirePerm('properties.read') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = await q1('SELECT * FROM properties WHERE id=$1 AND org_id=$2', [id, req.user!.orgId]);
    if (!p) return reply.code(404).send({ error: 'Imóvel não encontrado.' });
    const owner = p.owner_person_id ? await q1('SELECT id,name FROM people WHERE id=$1 AND org_id=$2', [p.owner_person_id, req.user!.orgId]) : null;
    const fav = await q1('SELECT 1 FROM favorites WHERE user_id=$1 AND property_id=$2', [req.user!.id, id]);
    return { ...stripInternal(p, req.user!.role), owner, is_favorite: !!fav };
  });

  app.patch('/api/properties/:id', { preHandler: requirePerm('properties.write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const cur = await q1('SELECT * FROM properties WHERE id=$1 AND org_id=$2', [id, req.user!.orgId]);
    if (!cur) return reply.code(404).send({ error: 'Imóvel não encontrado.' });
    const body = req.body as any;
    if (!can(req.user!.role, 'properties.internal')) delete body.internal_notes;
    const b = propertySchema.parse({ ...cur, ...body, captured_at: undefined });
    if (b.owner_person_id && !(await q1('SELECT 1 FROM people WHERE id=$1 AND org_id=$2', [b.owner_person_id, req.user!.orgId]))) return reply.code(400).send({ error: 'Proprietário não encontrado.' });
    const ad = b.address as any;
    const p = await q1(
      `UPDATE properties SET title=$3,description=$4,kind=$5,subtype=$6,purposes=$7,location_tags=$8,status=$9,address=$10,city=$11,state=$12,neighborhood=$13,latitude=$14,longitude=$15,price_sale=$16,price_rent=$17,price_lease=$18,recurring_fees=$19,area_total=$20,area_built=$21,area_unit=$22,bedrooms=$23,suites=$24,bathrooms=$25,parking=$26,urban_details=$27,rural_details=$28,coastal_details=$29,features=$30,owner_person_id=$31,broker_user_id=$32,available_from=$33,internal_notes=$34,publish_authorized=$35,show_exact_location=$36,show_price=$37,updated_by=$38,updated_at=now()
        WHERE id=$1 AND org_id=$2 RETURNING *`,
      [
        id, req.user!.orgId, b.title, b.description ?? null, b.kind, b.subtype, b.purposes, b.location_tags, b.status, JSON.stringify(b.address), ad.cidade ?? null, ad.uf ?? null, ad.bairro ?? null,
        b.latitude ?? null, b.longitude ?? null, b.price_sale ?? null, b.price_rent ?? null, b.price_lease ?? null, JSON.stringify(b.recurring_fees), b.area_total ?? null, b.area_built ?? null, b.area_unit,
        b.bedrooms ?? null, b.suites ?? null, b.bathrooms ?? null, b.parking ?? null, JSON.stringify(b.urban_details), JSON.stringify(b.rural_details), JSON.stringify(b.coastal_details), b.features,
        b.owner_person_id ?? null, b.broker_user_id ?? null, b.available_from ?? null,
        can(req.user!.role, 'properties.internal') ? (b.internal_notes ?? null) : cur.internal_notes, b.publish_authorized, b.show_exact_location, b.show_price, req.user!.id,
      ],
    );
    if (cur.status !== p.status || cur.publish_authorized !== p.publish_authorized) {
      await audit(req, 'property.status_or_publish', 'property', id, { from: cur.status, to: p.status, publish: p.publish_authorized });
    }
    return stripInternal(p, req.user!.role);
  });

  app.delete('/api/properties/:id', { preHandler: requirePerm('properties.write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await q(`UPDATE properties SET status='arquivado', publish_authorized=false, updated_by=$3, updated_at=now() WHERE id=$1 AND org_id=$2 RETURNING id`, [id, req.user!.orgId, req.user!.id]);
    if (!r.length) return reply.code(404).send({ error: 'Imóvel não encontrado.' });
    await audit(req, 'property.archive', 'property', id);
    return { ok: true };
  });

  // Favoritos privados
  app.put('/api/properties/:id/favorite', { preHandler: requirePerm('properties.read') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await q1('SELECT 1 FROM properties WHERE id=$1 AND org_id=$2', [id, req.user!.orgId]))) return reply.code(404).send({ error: 'Imóvel não encontrado.' });
    await q('INSERT INTO favorites(user_id,property_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user!.id, id]);
    return { ok: true };
  });
  app.delete('/api/properties/:id/favorite', { preHandler: requirePerm('properties.read') }, async (req) => {
    await q('DELETE FROM favorites WHERE user_id=$1 AND property_id=$2', [req.user!.id, (req.params as any).id]);
    return { ok: true };
  });

  // Busca salva
  app.get('/api/saved-searches', { preHandler: requirePerm('properties.read') }, async (req) =>
    q('SELECT id,name,filters,created_at FROM saved_searches WHERE org_id=$1 AND user_id=$2 ORDER BY created_at DESC', [req.user!.orgId, req.user!.id]),
  );
  app.post('/api/saved-searches', { preHandler: requirePerm('properties.read') }, async (req, reply) => {
    const b = z.object({ name: z.string().trim().min(1), filters: z.record(z.string(), z.any()) }).parse(req.body);
    const r = await q1('INSERT INTO saved_searches(org_id,user_id,name,filters) VALUES ($1,$2,$3,$4) RETURNING *', [req.user!.orgId, req.user!.id, b.name, JSON.stringify(b.filters)]);
    return reply.code(201).send(r);
  });
  app.delete('/api/saved-searches/:id', { preHandler: requirePerm('properties.read') }, async (req) => {
    await q('DELETE FROM saved_searches WHERE id=$1 AND user_id=$2 AND org_id=$3', [(req.params as any).id, req.user!.id, req.user!.orgId]);
    return { ok: true };
  });

  // Comparação (até 4 imóveis)
  app.get('/api/properties-compare', { preHandler: requirePerm('properties.read') }, async (req, reply) => {
    const ids = String((req.query as any).ids ?? '').split(',').filter(Boolean).slice(0, 4);
    if (ids.length < 2) return reply.code(400).send({ error: 'Escolha ao menos 2 imóveis para comparar.' });
    const rows = await q('SELECT * FROM properties WHERE org_id=$1 AND id = ANY($2::uuid[])', [req.user!.orgId, ids]);
    return rows.map((r) => stripInternal(r, req.user!.role));
  });

  // Imóveis semelhantes
  app.get('/api/properties/:id/similar', { preHandler: requirePerm('properties.read') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = await q1('SELECT * FROM properties WHERE id=$1 AND org_id=$2', [id, req.user!.orgId]);
    if (!p) return reply.code(404).send({ error: 'Imóvel não encontrado.' });
    const base = p.price_sale ?? p.price_rent ?? p.price_lease;
    const rows = await q(
      `SELECT * FROM properties WHERE org_id=$1 AND id<>$2 AND status IN ('disponivel','reservado')
         AND kind=$3 AND purposes && $4::text[]
         AND ($5::numeric IS NULL OR coalesce(price_sale,price_rent,price_lease) BETWEEN $5*0.7 AND $5*1.3)
       ORDER BY (city = $6) DESC, abs(coalesce(price_sale,price_rent,price_lease,0) - coalesce($5,0)) ASC LIMIT 6`,
      [req.user!.orgId, id, p.kind, p.purposes, base, p.city],
    );
    return rows.map((r) => stripInternal(r, req.user!.role));
  });

  // Correspondência: imóveis compatíveis com um cliente, com explicação
  app.get('/api/people/:id/matches', { preHandler: requirePerm('properties.read') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const person = await q1('SELECT id,name,profile FROM people WHERE id=$1 AND org_id=$2', [id, req.user!.orgId]);
    if (!person) return reply.code(404).send({ error: 'Pessoa não encontrada.' });
    const props = await q(`SELECT * FROM properties WHERE org_id=$1 AND status='disponivel'`, [req.user!.orgId]);
    const out = props
      .map((p) => ({ property: stripInternal(p, req.user!.role), ...matchScore(person.profile, p) }))
      .filter((m) => m.max > 0 && m.score >= 40)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
    return { person: { id: person.id, name: person.name }, hasProfile: Object.keys(person.profile ?? {}).length > 0, matches: out };
  });

  app.get('/api/properties/:id/matches', { preHandler: requirePerm('properties.read') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = await q1('SELECT * FROM properties WHERE id=$1 AND org_id=$2', [id, req.user!.orgId]);
    if (!p) return reply.code(404).send({ error: 'Imóvel não encontrado.' });
    const people = await q(`SELECT id,name,profile FROM people WHERE org_id=$1 AND archived_at IS NULL AND profile <> '{}'::jsonb`, [req.user!.orgId]);
    return people
      .map((x) => ({ person: { id: x.id, name: x.name }, ...matchScore(x.profile, p) }))
      .filter((m) => m.max > 0 && m.score >= 40)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
  });

  // Vincular imóveis a uma pessoa já é feito pelo funil (deal_properties).
}
