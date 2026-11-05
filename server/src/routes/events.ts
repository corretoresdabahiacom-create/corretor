import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { q, q1, tx } from '../db/pool.js';
import { requirePerm } from '../lib/auth.js';
import { can } from '../lib/permissions.js';

const TYPES = ['visita', 'reuniao', 'captacao', 'avaliacao', 'vistoria', 'assinatura', 'retorno', 'tarefa', 'vencimento', 'outro'] as const;
const iso = z.string().datetime({ offset: true });

const eventBody = z.object({
  type: z.enum(TYPES),
  title: z.string().trim().min(2, 'Informe o título.'),
  starts_at: iso,
  ends_at: iso,
  timezone: z.string().default('America/Sao_Paulo'),
  owner_user_id: z.string().uuid().optional().nullable(),
  participants: z.array(z.string().uuid()).default([]),
  person_id: z.string().uuid().optional().nullable(),
  property_id: z.string().uuid().optional().nullable(),
  deal_id: z.string().uuid().optional().nullable(),
  location: z.string().optional().nullable(),
  instructions: z.string().optional().nullable(),
  reminder_minutes: z.array(z.number().int().min(0).max(10080)).default([60]),
});

async function conflicts(orgId: string, userIds: string[], start: string, end: string, excludeId?: string) {
  if (!userIds.length) return [];
  return q(
    `SELECT e.id,e.title,e.starts_at,e.ends_at,e.owner_user_id, u.name AS owner_name
       FROM events e LEFT JOIN users u ON u.id=e.owner_user_id
      WHERE e.org_id=$1 AND e.status='agendado' AND ($5::uuid IS NULL OR e.id<>$5)
        AND (e.owner_user_id = ANY($2::uuid[]) OR e.participants && $2::uuid[])
        AND e.starts_at < $4::timestamptz AND e.ends_at > $3::timestamptz`,
    [orgId, userIds, start, end, excludeId ?? null],
  );
}

async function checkRefs(req: FastifyRequest, b: { person_id?: string | null; property_id?: string | null; deal_id?: string | null; participants?: string[]; owner_user_id?: string | null }) {
  const o = req.user!.orgId;
  if (b.person_id && !(await q1('SELECT 1 FROM people WHERE id=$1 AND org_id=$2', [b.person_id, o]))) return 'Pessoa não encontrada.';
  if (b.property_id && !(await q1('SELECT 1 FROM properties WHERE id=$1 AND org_id=$2', [b.property_id, o]))) return 'Imóvel não encontrado.';
  if (b.deal_id && !(await q1('SELECT 1 FROM deals WHERE id=$1 AND org_id=$2', [b.deal_id, o]))) return 'Oportunidade não encontrada.';
  const ids = [...(b.participants ?? []), ...(b.owner_user_id ? [b.owner_user_id] : [])];
  if (ids.length && (await q1('SELECT count(*)::int n FROM users WHERE org_id=$1 AND id = ANY($2::uuid[])', [o, ids])).n !== new Set(ids).size) return 'Participante inválido.';
  return null;
}

async function history(orgId: string, eventId: string, userId: string, action: string, detail: object = {}) {
  await q('INSERT INTO event_history(org_id,event_id,action,detail,user_id) VALUES ($1,$2,$3,$4,$5)', [orgId, eventId, action, JSON.stringify(detail), userId]);
}

async function loadEvent(req: FastifyRequest, id: string) {
  const e = await q1('SELECT * FROM events WHERE id=$1 AND org_id=$2', [id, req.user!.orgId]);
  if (!e) return null;
  if (!can(req.user!.role, 'events.all') && e.owner_user_id !== req.user!.id && !e.participants.includes(req.user!.id)) return null;
  return e;
}

export async function eventRoutes(app: FastifyInstance) {
  app.get('/api/events', { preHandler: requirePerm('events.read') }, async (req) => {
    const f = z.object({ from: iso.optional(), to: iso.optional(), owner: z.string().uuid().optional(), type: z.string().optional(), status: z.string().optional() }).parse(req.query);
    const params: unknown[] = [req.user!.orgId];
    const where = ['e.org_id=$1'];
    if (f.from) { params.push(f.from); where.push(`e.ends_at >= $${params.length}`); }
    if (f.to) { params.push(f.to); where.push(`e.starts_at <= $${params.length}`); }
    if (f.type) { params.push(f.type); where.push(`e.type=$${params.length}`); }
    if (f.status) { params.push(f.status); where.push(`e.status=$${params.length}`); }
    if (!can(req.user!.role, 'events.all')) { params.push(req.user!.id); where.push(`(e.owner_user_id=$${params.length} OR $${params.length}=ANY(e.participants))`); }
    else if (f.owner) { params.push(f.owner); where.push(`e.owner_user_id=$${params.length}`); }
    return q(
      `SELECT e.*, p.name AS person_name, pr.title AS property_title, pr.code AS property_code, u.name AS owner_name
         FROM events e LEFT JOIN people p ON p.id=e.person_id LEFT JOIN properties pr ON pr.id=e.property_id LEFT JOIN users u ON u.id=e.owner_user_id
        WHERE ${where.join(' AND ')} ORDER BY e.starts_at LIMIT 500`,
      params,
    );
  });

  app.post('/api/events', { preHandler: requirePerm('events.write') }, async (req, reply) => {
    const b = eventBody.parse(req.body);
    if (new Date(b.ends_at) <= new Date(b.starts_at)) return reply.code(400).send({ error: 'O fim precisa ser depois do início.' });
    const owner = b.owner_user_id ?? req.user!.id;
    if (owner !== req.user!.id && !can(req.user!.role, 'events.all')) return reply.code(403).send({ error: 'Você só pode agendar na sua própria agenda.' });
    const bad = await checkRefs(req, { ...b, owner_user_id: owner });
    if (bad) return reply.code(400).send({ error: bad });
    const force = (req.query as any)?.force === 'true';
    const cf = await conflicts(req.user!.orgId, [owner, ...b.participants], b.starts_at, b.ends_at);
    if (cf.length && !force) return reply.code(409).send({ error: 'Há conflito de horário na agenda.', code: 'CONFLICT', conflicts: cf });
    const e = await tx(async (c) => {
      const row = (
        await c.query(
          `INSERT INTO events(org_id,type,title,starts_at,ends_at,timezone,owner_user_id,participants,person_id,property_id,deal_id,location,instructions,reminder_minutes,created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
          [req.user!.orgId, b.type, b.title, b.starts_at, b.ends_at, b.timezone, owner, b.participants, b.person_id ?? null, b.property_id ?? null, b.deal_id ?? null, b.location ?? null, b.instructions ?? null, b.reminder_minutes, req.user!.id],
        )
      ).rows[0];
      await c.query('INSERT INTO event_history(org_id,event_id,action,detail,user_id) VALUES ($1,$2,$3,$4,$5)', [req.user!.orgId, row.id, 'criado', '{}', req.user!.id]);
      // Visita ligada a uma oportunidade que ainda está no início do funil avança para "Visita agendada"
      if (b.type === 'visita' && b.deal_id) {
        const d = (await c.query(`SELECT d.stage_key, s.position FROM deals d JOIN pipeline_stages s ON s.org_id=d.org_id AND s.key=d.stage_key WHERE d.id=$1`, [b.deal_id])).rows[0];
        const target = (await c.query(`SELECT position FROM pipeline_stages WHERE org_id=$1 AND key='visita_agendada'`, [req.user!.orgId])).rows[0];
        if (d && target && d.position < target.position) {
          await c.query(`UPDATE deals SET stage_key='visita_agendada', updated_at=now() WHERE id=$1`, [b.deal_id]);
          await c.query('INSERT INTO deal_stage_history(org_id,deal_id,from_stage,to_stage,user_id) VALUES ($1,$2,$3,$4,$5)', [req.user!.orgId, b.deal_id, d.stage_key, 'visita_agendada', req.user!.id]);
          await c.query(`INSERT INTO deal_activities(org_id,deal_id,type,body,user_id) VALUES ($1,$2,'visita','Visita agendada',$3)`, [req.user!.orgId, b.deal_id, req.user!.id]);
        }
      }
      return row;
    });
    return reply.code(201).send(e);
  });

  app.get('/api/events/:id', { preHandler: requirePerm('events.read') }, async (req, reply) => {
    const e = await loadEvent(req, (req.params as any).id);
    if (!e) return reply.code(404).send({ error: 'Compromisso não encontrado.' });
    const hist = await q('SELECT h.*, u.name AS user_name FROM event_history h LEFT JOIN users u ON u.id=h.user_id WHERE h.event_id=$1 AND h.org_id=$2 ORDER BY h.created_at DESC', [e.id, req.user!.orgId]);
    return { ...e, history: hist };
  });

  app.patch('/api/events/:id', { preHandler: requirePerm('events.write') }, async (req, reply) => {
    const cur = await loadEvent(req, (req.params as any).id);
    if (!cur) return reply.code(404).send({ error: 'Compromisso não encontrado.' });
    const b = eventBody.partial().parse(req.body);
    const m = { ...cur, ...b };
    if (new Date(m.ends_at) <= new Date(m.starts_at)) return reply.code(400).send({ error: 'O fim precisa ser depois do início.' });
    const bad = await checkRefs(req, m);
    if (bad) return reply.code(400).send({ error: bad });
    const timeChanged = b.starts_at !== undefined || b.ends_at !== undefined || b.owner_user_id !== undefined;
    if (timeChanged && cur.status === 'agendado' && (req.query as any)?.force !== 'true') {
      const cf = await conflicts(req.user!.orgId, [m.owner_user_id, ...m.participants].filter(Boolean), new Date(m.starts_at).toISOString(), new Date(m.ends_at).toISOString(), cur.id);
      if (cf.length) return reply.code(409).send({ error: 'Há conflito de horário na agenda.', code: 'CONFLICT', conflicts: cf });
    }
    const r = await q1(
      `UPDATE events SET type=$3,title=$4,starts_at=$5,ends_at=$6,timezone=$7,owner_user_id=$8,participants=$9,person_id=$10,property_id=$11,deal_id=$12,location=$13,instructions=$14,reminder_minutes=$15,updated_at=now() WHERE id=$1 AND org_id=$2 RETURNING *`,
      [cur.id, req.user!.orgId, m.type, m.title, m.starts_at, m.ends_at, m.timezone, m.owner_user_id, m.participants, m.person_id, m.property_id, m.deal_id, m.location, m.instructions, m.reminder_minutes],
    );
    await history(req.user!.orgId, cur.id, req.user!.id, 'editado', { campos: Object.keys(b) });
    return r;
  });

  app.post('/api/events/:id/reschedule', { preHandler: requirePerm('events.write') }, async (req, reply) => {
    const cur = await loadEvent(req, (req.params as any).id);
    if (!cur) return reply.code(404).send({ error: 'Compromisso não encontrado.' });
    if (cur.status !== 'agendado') return reply.code(409).send({ error: 'Só é possível reagendar compromissos agendados.' });
    const b = z.object({ starts_at: iso, ends_at: iso, reason: z.string().optional() }).parse(req.body);
    if (new Date(b.ends_at) <= new Date(b.starts_at)) return reply.code(400).send({ error: 'O fim precisa ser depois do início.' });
    const cf = await conflicts(req.user!.orgId, [cur.owner_user_id, ...cur.participants].filter(Boolean), b.starts_at, b.ends_at, cur.id);
    if (cf.length && (req.query as any)?.force !== 'true') return reply.code(409).send({ error: 'Há conflito de horário na agenda.', code: 'CONFLICT', conflicts: cf });
    const r = await q1('UPDATE events SET starts_at=$3, ends_at=$4, updated_at=now() WHERE id=$1 AND org_id=$2 RETURNING *', [cur.id, req.user!.orgId, b.starts_at, b.ends_at]);
    await history(req.user!.orgId, cur.id, req.user!.id, 'reagendado', { de: cur.starts_at, para: b.starts_at, motivo: b.reason ?? null });
    return r;
  });

  app.post('/api/events/:id/cancel', { preHandler: requirePerm('events.write') }, async (req, reply) => {
    const cur = await loadEvent(req, (req.params as any).id);
    if (!cur) return reply.code(404).send({ error: 'Compromisso não encontrado.' });
    if (cur.status !== 'agendado') return reply.code(409).send({ error: 'Este compromisso já foi encerrado.' });
    const b = z.object({ reason: z.string().optional() }).parse(req.body ?? {});
    await q(`UPDATE events SET status='cancelado', updated_at=now() WHERE id=$1`, [cur.id]);
    await history(req.user!.orgId, cur.id, req.user!.id, 'cancelado', { motivo: b.reason ?? null });
    return { ok: true };
  });

  app.post('/api/events/:id/complete', { preHandler: requirePerm('events.write') }, async (req, reply) => {
    const cur = await loadEvent(req, (req.params as any).id);
    if (!cur) return reply.code(404).send({ error: 'Compromisso não encontrado.' });
    if (cur.status !== 'agendado') return reply.code(409).send({ error: 'Este compromisso já foi encerrado.' });
    const b = z.object({ outcome: z.string().trim().min(1, 'Registre o resultado.'), next_action: z.string().optional() }).parse(req.body);
    await tx(async (c) => {
      await c.query(`UPDATE events SET status='concluido', outcome=$2, next_action=$3, updated_at=now() WHERE id=$1`, [cur.id, b.outcome, b.next_action ?? null]);
      await c.query('INSERT INTO event_history(org_id,event_id,action,detail,user_id) VALUES ($1,$2,$3,$4,$5)', [req.user!.orgId, cur.id, 'concluido', JSON.stringify({ outcome: b.outcome }), req.user!.id]);
      if (cur.type === 'visita' && cur.deal_id) {
        const d = (await c.query(`SELECT d.stage_key, s.position FROM deals d JOIN pipeline_stages s ON s.org_id=d.org_id AND s.key=d.stage_key WHERE d.id=$1`, [cur.deal_id])).rows[0];
        const target = (await c.query(`SELECT position FROM pipeline_stages WHERE org_id=$1 AND key='visita_realizada'`, [req.user!.orgId])).rows[0];
        if (d && target && d.position < target.position) {
          await c.query(`UPDATE deals SET stage_key='visita_realizada', next_action=coalesce($2,next_action), updated_at=now() WHERE id=$1`, [cur.deal_id, b.next_action ?? null]);
          await c.query('INSERT INTO deal_stage_history(org_id,deal_id,from_stage,to_stage,user_id) VALUES ($1,$2,$3,$4,$5)', [req.user!.orgId, cur.deal_id, d.stage_key, 'visita_realizada', req.user!.id]);
        }
        await c.query(`INSERT INTO deal_activities(org_id,deal_id,type,body,user_id) VALUES ($1,$2,'visita',$3,$4)`, [req.user!.orgId, cur.deal_id, `Visita realizada: ${b.outcome}`, req.user!.id]);
      }
    });
    return { ok: true };
  });

  // Lembretes dentro do aplicativo (nenhum envio por e-mail/WhatsApp/SMS é feito)
  app.get('/api/reminders', { preHandler: requirePerm('events.read') }, async (req) => {
    return q(
      `SELECT e.id,e.title,e.type,e.starts_at, min(m) AS minutes_before
         FROM events e, unnest(e.reminder_minutes) AS m
        WHERE e.org_id=$1 AND e.status='agendado' AND (e.owner_user_id=$2 OR $2=ANY(e.participants))
          AND e.starts_at > now() AND e.starts_at - (m || ' minutes')::interval <= now()
        GROUP BY e.id ORDER BY e.starts_at LIMIT 20`,
      [req.user!.orgId, req.user!.id],
    );
  });
}
