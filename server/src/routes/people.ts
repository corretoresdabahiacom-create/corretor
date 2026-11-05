import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { q, q1, tx } from '../db/pool.js';
import { audit, requirePerm } from '../lib/auth.js';
import { can, type Role } from '../lib/permissions.js';
import { digits, isValidDocument, isValidPhone, normalizePhone } from '../lib/validators.js';

export const PERSON_ROLES = [
  'comprador', 'vendedor', 'interessado', 'proprietario', 'locador', 'locatario',
  'arrendador', 'arrendatario', 'fiador', 'corretor', 'parceiro', 'contato_referencia',
] as const;

const profileSchema = z
  .object({
    property_kinds: z.array(z.string()).optional(),      // casa, apartamento, fazenda...
    purposes: z.array(z.enum(['venda', 'aluguel', 'temporada', 'arrendamento'])).optional(),
    budget_min: z.number().nonnegative().nullable().optional(),
    budget_max: z.number().nonnegative().nullable().optional(),
    regions: z.array(z.string()).optional(),             // cidades/bairros
    bedrooms_min: z.number().int().nonnegative().nullable().optional(),
    bathrooms_min: z.number().int().nonnegative().nullable().optional(),
    area_min: z.number().nonnegative().nullable().optional(),
    area_unit: z.enum(['m2', 'ha', 'alqueire']).optional(),
    parking_min: z.number().int().nonnegative().nullable().optional(),
    features: z.array(z.string()).optional(),
    use: z.enum(['residencial', 'comercial', 'rural', 'investimento']).optional(),
    location_tags: z.array(z.string()).optional(),        // litoral, serra...
    decision_deadline: z.string().nullable().optional(),
    notes: z.string().optional(),
  })
  .strict();

const personSchema = z
  .object({
    kind: z.enum(['fisica', 'juridica']).default('fisica'),
    name: z.string().trim().min(2, 'Informe o nome.'),
    display_name: z.string().trim().optional().nullable(),
    document: z.string().trim().optional().nullable(),
    phones: z.array(z.string()).default([]),
    emails: z.array(z.string().trim().toLowerCase().email('E-mail inválido.')).default([]),
    address: z.record(z.string(), z.any()).default({}),
    contact_pref: z.enum(['whatsapp', 'telefone', 'email']).optional().nullable(),
    roles: z.array(z.enum(PERSON_ROLES)).default([]),
    owner_user_id: z.string().uuid().optional().nullable(),
    source: z.string().trim().optional().nullable(),
    private_notes: z.string().optional().nullable(),
    consent: z.record(z.string(), z.any()).default({}),
    relationship_status: z.enum(['ativo', 'aguardando_retorno', 'inativo']).default('ativo'),
    profile: profileSchema.default({}),
  })
  .superRefine((p, ctx) => {
    if (p.document && !isValidDocument(p.kind, p.document)) {
      ctx.addIssue({ code: 'custom', path: ['document'], message: p.kind === 'fisica' ? 'CPF inválido.' : 'CNPJ inválido.' });
    }
    p.phones.forEach((ph, i) => {
      if (!isValidPhone(ph)) ctx.addIssue({ code: 'custom', path: ['phones', i], message: 'Telefone inválido. Use DDD + número.' });
    });
  });

/** Aplica restrições de acesso aos campos sensíveis conforme o papel. */
export function presentPerson(p: any, role: Role) {
  const out = { ...p };
  out.document_masked = !can(role, 'people.document');
  if (out.document_masked) out.document = out.document ? maskDoc(out.document) : null;
  if (!can(role, 'people.private_notes')) out.private_notes = null;
  delete out.document_norm;
  return out;
}
const maskDoc = (d: string) => {
  const n = digits(d);
  return n.length === 11 ? `***.${n.slice(3, 6)}.***-**` : `**.***.${n.slice(5, 8)}/****-**`;
};

async function findDuplicates(orgId: string, p: { document?: string | null; phones: string[]; emails: string[] }, excludeId?: string) {
  const doc = p.document ? digits(p.document) : null;
  const phones = p.phones.map(normalizePhone);
  return q(
    `SELECT id, name, phones, emails,
            (document_norm IS NOT NULL AND document_norm = $2) AS same_document
       FROM people
      WHERE org_id=$1 AND archived_at IS NULL AND ($5::uuid IS NULL OR id<>$5)
        AND ( ($2::text IS NOT NULL AND document_norm = $2)
           OR (cardinality($3::text[])>0 AND phones && $3::text[])
           OR (cardinality($4::text[])>0 AND emails && $4::text[]) )
      LIMIT 10`,
    [orgId, doc, phones, p.emails, excludeId ?? null],
  );
}

export async function peopleRoutes(app: FastifyInstance) {
  app.get('/api/people', { preHandler: requirePerm('people.read') }, async (req) => {
    const f = z
      .object({
        q: z.string().optional(), role: z.string().optional(), status: z.string().optional(), owner: z.string().uuid().optional(),
        sort: z.enum(['name', 'recent']).default('recent'),
        page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
      })
      .parse(req.query);
    const where: string[] = ['org_id=$1', 'archived_at IS NULL'];
    const params: unknown[] = [req.user!.orgId];
    if (f.q) {
      params.push(`%${f.q}%`, digits(f.q));
      where.push(`(name ILIKE $${params.length - 1} OR display_name ILIKE $${params.length - 1} OR EXISTS (SELECT 1 FROM unnest(emails) e WHERE e ILIKE $${params.length - 1}) OR ($${params.length} <> '' AND (EXISTS (SELECT 1 FROM unnest(phones) ph WHERE ph LIKE '%'||$${params.length}||'%') OR document_norm LIKE '%'||$${params.length}||'%')))`);
    }
    if (f.role) { params.push(f.role); where.push(`$${params.length} = ANY(roles)`); }
    if (f.status) { params.push(f.status); where.push(`relationship_status=$${params.length}`); }
    if (f.owner) { params.push(f.owner); where.push(`owner_user_id=$${params.length}`); }
    const total = (await q1(`SELECT count(*)::int AS n FROM people WHERE ${where.join(' AND ')}`, params)).n;
    params.push(f.pageSize, (f.page - 1) * f.pageSize);
    const rows = await q(
      `SELECT * FROM people WHERE ${where.join(' AND ')} ORDER BY ${f.sort === 'name' ? 'name' : 'updated_at DESC'} LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { total, page: f.page, pageSize: f.pageSize, items: rows.map((r) => presentPerson(r, req.user!.role)) };
  });

  app.post('/api/people', { preHandler: requirePerm('people.write') }, async (req, reply) => {
    const body = personSchema.parse(req.body);
    const force = (req.query as any)?.force === 'true';
    const dups = await findDuplicates(req.user!.orgId, body);
    if (dups.length && !force) {
      return reply.code(409).send({ error: 'Encontramos cadastros parecidos. Revise antes de criar outro.', duplicates: dups, code: 'POSSIBLE_DUPLICATE' });
    }
    const p = await q1(
      `INSERT INTO people(org_id,kind,name,display_name,document,document_norm,phones,emails,address,contact_pref,roles,owner_user_id,source,private_notes,consent,relationship_status,profile,created_by,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18) RETURNING *`,
      [
        req.user!.orgId, body.kind, body.name, body.display_name ?? null, body.document ?? null,
        body.document ? digits(body.document) : null, body.phones.map(normalizePhone), body.emails,
        JSON.stringify(body.address), body.contact_pref ?? null, body.roles, body.owner_user_id ?? req.user!.id,
        body.source ?? null, body.private_notes ?? null,
        JSON.stringify({ ...body.consent, recorded_at: new Date().toISOString(), recorded_by: req.user!.id }),
        body.relationship_status, JSON.stringify(body.profile), req.user!.id,
      ],
    );
    await audit(req, 'person.create', 'person', p.id);
    return reply.code(201).send(presentPerson(p, req.user!.role));
  });

  app.post('/api/people/check-duplicates', { preHandler: requirePerm('people.read') }, async (req) => {
    const b = z.object({ document: z.string().optional().nullable(), phones: z.array(z.string()).default([]), emails: z.array(z.string()).default([]), excludeId: z.string().uuid().optional() }).parse(req.body);
    return { duplicates: await findDuplicates(req.user!.orgId, b, b.excludeId) };
  });

  app.get('/api/people/:id', { preHandler: requirePerm('people.read') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = await q1('SELECT * FROM people WHERE id=$1 AND org_id=$2', [id, req.user!.orgId]);
    if (!p) return reply.code(404).send({ error: 'Pessoa não encontrada.' });
    const [interactions, deals, properties] = await Promise.all([
      q('SELECT i.*, u.name AS user_name FROM person_interactions i LEFT JOIN users u ON u.id=i.user_id WHERE i.person_id=$1 AND i.org_id=$2 ORDER BY i.created_at DESC LIMIT 50', [id, req.user!.orgId]),
      q('SELECT id, purpose, stage_key, estimated_value FROM deals WHERE person_id=$1 AND org_id=$2 ORDER BY created_at DESC', [id, req.user!.orgId]),
      q('SELECT id, code, title, status FROM properties WHERE owner_person_id=$1 AND org_id=$2', [id, req.user!.orgId]),
    ]);
    if (can(req.user!.role, 'people.document') && p.document) await audit(req, 'person.view_document', 'person', id);
    return { ...presentPerson(p, req.user!.role), interactions, deals, owned_properties: properties };
  });

  app.patch('/api/people/:id', { preHandler: requirePerm('people.write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const cur = await q1('SELECT * FROM people WHERE id=$1 AND org_id=$2', [id, req.user!.orgId]);
    if (!cur) return reply.code(404).send({ error: 'Pessoa não encontrada.' });
    // Quem não pode ver o documento/observações privadas também não pode sobrescrevê-los às cegas.
    const merged = personSchema.parse({ ...cur, ...(req.body as object), document: can(req.user!.role, 'people.document') ? ((req.body as any).document ?? cur.document) : cur.document });
    const p = await q1(
      `UPDATE people SET kind=$3,name=$4,display_name=$5,document=$6,document_norm=$7,phones=$8,emails=$9,address=$10,contact_pref=$11,roles=$12,owner_user_id=$13,source=$14,private_notes=$15,consent=$16,relationship_status=$17,profile=$18,updated_by=$19,updated_at=now()
        WHERE id=$1 AND org_id=$2 RETURNING *`,
      [
        id, req.user!.orgId, merged.kind, merged.name, merged.display_name ?? null, merged.document ?? null,
        merged.document ? digits(merged.document) : null, merged.phones.map(normalizePhone), merged.emails,
        JSON.stringify(merged.address), merged.contact_pref ?? null, merged.roles, merged.owner_user_id ?? null, merged.source ?? null,
        can(req.user!.role, 'people.private_notes') ? (merged.private_notes ?? null) : cur.private_notes,
        JSON.stringify(cur.consent ?? {}), merged.relationship_status, JSON.stringify(merged.profile), req.user!.id,
      ],
    );
    await audit(req, 'person.update', 'person', id);
    return presentPerson(p, req.user!.role);
  });

  app.post('/api/people/:id/interactions', { preHandler: requirePerm('people.write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z.object({ type: z.enum(['nota', 'ligacao', 'whatsapp', 'email', 'visita']).default('nota'), body: z.string().trim().min(1, 'Escreva o registro.') }).parse(req.body);
    if (!(await q1('SELECT 1 FROM people WHERE id=$1 AND org_id=$2', [id, req.user!.orgId]))) return reply.code(404).send({ error: 'Pessoa não encontrada.' });
    const row = await q1('INSERT INTO person_interactions(org_id,person_id,type,body,user_id) VALUES ($1,$2,$3,$4,$5) RETURNING *', [req.user!.orgId, id, b.type, b.body, req.user!.id]);
    await q('UPDATE people SET updated_at=now() WHERE id=$1', [id]);
    return reply.code(201).send(row);
  });

  app.delete('/api/people/:id', { preHandler: requirePerm('people.write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await q('UPDATE people SET archived_at=now(), updated_by=$3 WHERE id=$1 AND org_id=$2 AND archived_at IS NULL RETURNING id', [id, req.user!.orgId, req.user!.id]);
    if (!r.length) return reply.code(404).send({ error: 'Pessoa não encontrada.' });
    await audit(req, 'person.archive', 'person', id);
    return { ok: true };
  });

  // Mesclagem somente com ação explícita do usuário (nunca automática)
  app.post('/api/people/:id/merge', { preHandler: requirePerm('users.manage') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { intoId } = z.object({ intoId: z.string().uuid() }).parse(req.body);
    if (id === intoId) return reply.code(400).send({ error: 'Escolha dois cadastros diferentes.' });
    const [a, b] = await Promise.all([
      q1('SELECT * FROM people WHERE id=$1 AND org_id=$2 AND archived_at IS NULL', [id, req.user!.orgId]),
      q1('SELECT * FROM people WHERE id=$1 AND org_id=$2 AND archived_at IS NULL', [intoId, req.user!.orgId]),
    ]);
    if (!a || !b) return reply.code(404).send({ error: 'Cadastro não encontrado.' });
    await tx(async (c) => {
      await c.query('UPDATE deals SET person_id=$2 WHERE person_id=$1', [id, intoId]);
      await c.query('UPDATE properties SET owner_person_id=$2 WHERE owner_person_id=$1', [id, intoId]);
      await c.query('UPDATE person_interactions SET person_id=$2 WHERE person_id=$1', [id, intoId]);
      await c.query('UPDATE events SET person_id=$2 WHERE person_id=$1', [id, intoId]);
      await c.query(
        `UPDATE people SET roles=(SELECT array(SELECT DISTINCT unnest(roles||$2::text[]))), phones=(SELECT array(SELECT DISTINCT unnest(phones||$3::text[]))),
                emails=(SELECT array(SELECT DISTINCT unnest(emails||$4::text[]))), document=coalesce(document,$5), document_norm=coalesce(document_norm,$6), updated_at=now() WHERE id=$1`,
        [intoId, a.roles, a.phones, a.emails, a.document, a.document_norm],
      );
      await c.query('UPDATE people SET archived_at=now() WHERE id=$1', [id]);
    });
    await audit(req, 'person.merge', 'person', intoId, { from: id });
    return { ok: true };
  });
}
