import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { q, q1, tx } from '../db/pool.js';
import { audit, requirePerm } from '../lib/auth.js';
import { can } from '../lib/permissions.js';

const PURPOSES = ['venda', 'aluguel', 'temporada', 'arrendamento'] as const;

async function loadDeal(req: FastifyRequest, id: string) {
  const d = await q1('SELECT * FROM deals WHERE id=$1 AND org_id=$2', [id, req.user!.orgId]);
  if (!d) return null;
  // Corretor/assistente só enxergam as próprias oportunidades; gestor/admin veem todas.
  if (!can(req.user!.role, 'deals.all') && d.owner_user_id !== req.user!.id) return null;
  return d;
}

const dealBase = z.object({
  purpose: z.enum(PURPOSES).optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
  source: z.string().trim().nullable().optional(),
  estimated_value: z.number().nonnegative().nullable().optional(),
  next_action: z.string().trim().nullable().optional(),
  follow_up_at: z.string().datetime({ offset: true }).nullable().optional(),
  private_notes: z.string().nullable().optional(),
});

export async function dealRoutes(app: FastifyInstance) {
  app.get('/api/pipeline/stages', { preHandler: requirePerm('deals.read') }, async (req) =>
    q('SELECT key,label,position,kind FROM pipeline_stages WHERE org_id=$1 ORDER BY position', [req.user!.orgId]),
  );

  app.patch('/api/pipeline/stages/:key', { preHandler: requirePerm('org.manage') }, async (req, reply) => {
    const { key } = req.params as { key: string };
    const b = z.object({ label: z.string().trim().min(2) }).parse(req.body);
    const r = await q('UPDATE pipeline_stages SET label=$3 WHERE org_id=$1 AND key=$2 RETURNING key', [req.user!.orgId, key, b.label]);
    if (!r.length) return reply.code(404).send({ error: 'Etapa não encontrada.' });
    return { ok: true };
  });

  app.get('/api/deals', { preHandler: requirePerm('deals.read') }, async (req) => {
    const f = z.object({ stage: z.string().optional(), owner: z.string().uuid().optional(), status: z.enum(['abertas', 'ganhas', 'perdidas', 'todas']).default('abertas'), q: z.string().optional() }).parse(req.query);
    const params: unknown[] = [req.user!.orgId];
    const where = ['d.org_id=$1'];
    if (!can(req.user!.role, 'deals.all')) { params.push(req.user!.id); where.push(`d.owner_user_id=$${params.length}`); }
    else if (f.owner) { params.push(f.owner); where.push(`d.owner_user_id=$${params.length}`); }
    if (f.stage) { params.push(f.stage); where.push(`d.stage_key=$${params.length}`); }
    if (f.status !== 'todas') { params.push(f.status === 'abertas' ? 'aberta' : f.status === 'ganhas' ? 'ganha' : 'perdida'); where.push(`s.kind=$${params.length}`); }
    if (f.q) { params.push(`%${f.q}%`); where.push(`p.name ILIKE $${params.length}`); }
    return q(
      `SELECT d.id,d.purpose,d.stage_key,d.estimated_value,d.negotiated_value,d.closed_value,d.next_action,d.follow_up_at,d.owner_user_id,d.source,d.created_at,d.updated_at,
              p.id AS person_id,p.name AS person_name, u.name AS owner_name, s.kind AS stage_kind,
              (SELECT count(*)::int FROM deal_properties dp WHERE dp.deal_id=d.id) AS property_count
         FROM deals d JOIN people p ON p.id=d.person_id JOIN pipeline_stages s ON s.org_id=d.org_id AND s.key=d.stage_key LEFT JOIN users u ON u.id=d.owner_user_id
        WHERE ${where.join(' AND ')} ORDER BY d.updated_at DESC LIMIT 500`,
      params,
    );
  });

  app.post('/api/deals', { preHandler: requirePerm('deals.write') }, async (req, reply) => {
    const b = dealBase
      .extend({ person_id: z.string().uuid(), property_ids: z.array(z.string().uuid()).default([]), purpose: z.enum(PURPOSES).default('venda') })
      .parse(req.body);
    const force = (req.query as any)?.force === 'true';
    if (!(await q1('SELECT 1 FROM people WHERE id=$1 AND org_id=$2 AND archived_at IS NULL', [b.person_id, req.user!.orgId]))) return reply.code(400).send({ error: 'Pessoa não encontrada.' });
    if (b.property_ids.length) {
      const n = (await q1('SELECT count(*)::int n FROM properties WHERE org_id=$1 AND id = ANY($2::uuid[])', [req.user!.orgId, b.property_ids])).n;
      if (n !== new Set(b.property_ids).size) return reply.code(400).send({ error: 'Algum imóvel informado não existe.' });
    }
    // Prevenção de duplicidade: mesma pessoa + mesma finalidade com oportunidade aberta
    const dup = await q1(
      `SELECT d.id, d.stage_key FROM deals d JOIN pipeline_stages s ON s.org_id=d.org_id AND s.key=d.stage_key
        WHERE d.org_id=$1 AND d.person_id=$2 AND d.purpose=$3 AND s.kind='aberta' LIMIT 1`,
      [req.user!.orgId, b.person_id, b.purpose],
    );
    if (dup && !force) return reply.code(409).send({ error: 'Já existe uma oportunidade aberta para esta pessoa e finalidade.', code: 'DUPLICATE_DEAL', existing_id: dup.id });
    const first = (await q1(`SELECT key FROM pipeline_stages WHERE org_id=$1 AND kind='aberta' ORDER BY position LIMIT 1`, [req.user!.orgId])).key;
    const d = await tx(async (c) => {
      const row = (
        await c.query(
          `INSERT INTO deals(org_id,person_id,purpose,stage_key,owner_user_id,source,estimated_value,next_action,follow_up_at,private_notes,created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [req.user!.orgId, b.person_id, b.purpose, first, b.owner_user_id ?? req.user!.id, b.source ?? null, b.estimated_value ?? null, b.next_action ?? null, b.follow_up_at ?? null, b.private_notes ?? null, req.user!.id],
        )
      ).rows[0];
      for (const pid of new Set(b.property_ids)) await c.query('INSERT INTO deal_properties(deal_id,property_id) VALUES ($1,$2)', [row.id, pid]);
      await c.query('INSERT INTO deal_stage_history(org_id,deal_id,from_stage,to_stage,user_id) VALUES ($1,$2,NULL,$3,$4)', [req.user!.orgId, row.id, first, req.user!.id]);
      await c.query(`INSERT INTO deal_activities(org_id,deal_id,type,body,user_id) VALUES ($1,$2,'etapa','Oportunidade criada',$3)`, [req.user!.orgId, row.id, req.user!.id]);
      return row;
    });
    await audit(req, 'deal.create', 'deal', d.id);
    return reply.code(201).send(d);
  });

  app.get('/api/deals/:id', { preHandler: requirePerm('deals.read') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const d = await loadDeal(req, id);
    if (!d) return reply.code(404).send({ error: 'Oportunidade não encontrada.' });
    const o = req.user!.orgId;
    const [person, properties, activities, proposals, reservations, events, tasks] = await Promise.all([
      q1('SELECT id,name,phones,emails,roles FROM people WHERE id=$1 AND org_id=$2', [d.person_id, o]),
      q('SELECT p.id,p.code,p.title,p.status,p.price_sale,p.price_rent,p.price_lease FROM deal_properties dp JOIN properties p ON p.id=dp.property_id WHERE dp.deal_id=$1 AND p.org_id=$2', [id, o]),
      q('SELECT a.*, u.name AS user_name FROM deal_activities a LEFT JOIN users u ON u.id=a.user_id WHERE a.deal_id=$1 AND a.org_id=$2 ORDER BY a.created_at DESC LIMIT 100', [id, o]),
      q('SELECT * FROM proposals WHERE deal_id=$1 AND org_id=$2 ORDER BY created_at DESC', [id, o]),
      q('SELECT * FROM reservations WHERE deal_id=$1 AND org_id=$2 ORDER BY created_at DESC', [id, o]),
      q('SELECT id,type,title,starts_at,status FROM events WHERE deal_id=$1 AND org_id=$2 ORDER BY starts_at DESC', [id, o]),
      q('SELECT * FROM tasks WHERE deal_id=$1 AND org_id=$2 ORDER BY done_at NULLS FIRST, due_at', [id, o]),
    ]);
    return { ...d, person, properties, activities, proposals, reservations, events, tasks };
  });

  app.patch('/api/deals/:id', { preHandler: requirePerm('deals.write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const cur = await loadDeal(req, id);
    if (!cur) return reply.code(404).send({ error: 'Oportunidade não encontrada.' });
    const b = dealBase.parse(req.body);
    if (b.owner_user_id !== undefined && b.owner_user_id !== cur.owner_user_id && !can(req.user!.role, 'deals.all')) return reply.code(403).send({ error: 'Apenas gestores podem trocar o responsável.' });
    const m = { ...cur, ...b };
    const r = await q1(
      `UPDATE deals SET purpose=$3,owner_user_id=$4,source=$5,estimated_value=$6,next_action=$7,follow_up_at=$8,private_notes=$9,updated_at=now() WHERE id=$1 AND org_id=$2 RETURNING *`,
      [id, req.user!.orgId, m.purpose, m.owner_user_id, m.source, m.estimated_value, m.next_action, m.follow_up_at, m.private_notes],
    );
    return r;
  });

  app.post('/api/deals/:id/stage', { preHandler: requirePerm('deals.write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const cur = await loadDeal(req, id);
    if (!cur) return reply.code(404).send({ error: 'Oportunidade não encontrada.' });
    const b = z.object({ stage_key: z.string(), lost_reason: z.string().trim().optional(), closed_value: z.number().positive().optional() }).parse(req.body);
    const target = await q1('SELECT key,label,kind FROM pipeline_stages WHERE org_id=$1 AND key=$2', [req.user!.orgId, b.stage_key]);
    if (!target) return reply.code(400).send({ error: 'Etapa inexistente.' });
    const from = await q1('SELECT kind FROM pipeline_stages WHERE org_id=$1 AND key=$2', [req.user!.orgId, cur.stage_key]);
    if (target.kind === 'perdida' && !b.lost_reason) return reply.code(400).send({ error: 'Informe o motivo da perda.' });
    // Negócio só é "fechado" com valor efetivamente concluído informado — proposta enviada não conta.
    if (target.kind === 'ganha' && b.closed_value == null) return reply.code(400).send({ error: 'Informe o valor efetivamente fechado.' });
    if (from.kind !== 'aberta' && !can(req.user!.role, 'deals.all')) return reply.code(403).send({ error: 'Somente gestores podem reabrir negócios encerrados.' });
    await tx(async (c) => {
      await c.query(
        `UPDATE deals SET stage_key=$3, updated_at=now(),
           lost_reason = CASE WHEN $4::text='perdida' THEN $5::text ELSE NULL END,
           closed_value = CASE WHEN $4::text='ganha' THEN $6::numeric ELSE NULL END,
           closed_at = CASE WHEN $4::text IN ('ganha','perdida') THEN now() ELSE NULL END
         WHERE id=$1 AND org_id=$2`,
        [id, req.user!.orgId, b.stage_key, target.kind, b.lost_reason ?? null, b.closed_value ?? null],
      );
      await c.query('INSERT INTO deal_stage_history(org_id,deal_id,from_stage,to_stage,user_id) VALUES ($1,$2,$3,$4,$5)', [req.user!.orgId, id, cur.stage_key, b.stage_key, req.user!.id]);
      await c.query(`INSERT INTO deal_activities(org_id,deal_id,type,body,user_id) VALUES ($1,$2,'etapa',$3,$4)`, [req.user!.orgId, id, `Etapa: ${target.label}${b.lost_reason ? ` — motivo: ${b.lost_reason}` : ''}`, req.user!.id]);
      if (target.kind === 'ganha') {
        const status = ({ venda: 'vendido', aluguel: 'alugado', temporada: 'alugado', arrendamento: 'arrendado' } as any)[cur.purpose];
        await c.query(`UPDATE properties SET status=$3, updated_at=now() WHERE org_id=$1 AND id IN (SELECT property_id FROM deal_properties WHERE deal_id=$2) AND status IN ('disponivel','reservado','em_negociacao')
                        AND id = (SELECT property_id FROM deal_properties WHERE deal_id=$2 ORDER BY property_id LIMIT 1)`, [req.user!.orgId, id, status]);
      }
    });
    await audit(req, 'deal.stage', 'deal', id, { from: cur.stage_key, to: b.stage_key });
    return { ok: true };
  });

  app.post('/api/deals/:id/properties', { preHandler: requirePerm('deals.write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await loadDeal(req, id))) return reply.code(404).send({ error: 'Oportunidade não encontrada.' });
    const { property_id } = z.object({ property_id: z.string().uuid() }).parse(req.body);
    if (!(await q1('SELECT 1 FROM properties WHERE id=$1 AND org_id=$2', [property_id, req.user!.orgId]))) return reply.code(400).send({ error: 'Imóvel não encontrado.' });
    await q('INSERT INTO deal_properties(deal_id,property_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, property_id]);
    await q(`INSERT INTO deal_activities(org_id,deal_id,type,body,user_id) VALUES ($1,$2,'nota','Imóvel vinculado',$3)`, [req.user!.orgId, id, req.user!.id]);
    return { ok: true };
  });
  app.delete('/api/deals/:id/properties/:pid', { preHandler: requirePerm('deals.write') }, async (req, reply) => {
    const { id, pid } = req.params as { id: string; pid: string };
    if (!(await loadDeal(req, id))) return reply.code(404).send({ error: 'Oportunidade não encontrada.' });
    await q('DELETE FROM deal_properties WHERE deal_id=$1 AND property_id=$2', [id, pid]);
    return { ok: true };
  });

  app.post('/api/deals/:id/activities', { preHandler: requirePerm('deals.write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await loadDeal(req, id))) return reply.code(404).send({ error: 'Oportunidade não encontrada.' });
    const b = z.object({ body: z.string().trim().min(1, 'Escreva a anotação.') }).parse(req.body);
    const r = await q1(`INSERT INTO deal_activities(org_id,deal_id,type,body,user_id) VALUES ($1,$2,'nota',$3,$4) RETURNING *`, [req.user!.orgId, id, b.body, req.user!.id]);
    await q('UPDATE deals SET updated_at=now() WHERE id=$1', [id]);
    return reply.code(201).send(r);
  });

  // Propostas e contrapropostas — registro; não alteram a etapa nem contam como negócio fechado.
  app.post('/api/deals/:id/proposals', { preHandler: requirePerm('deals.write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await loadDeal(req, id))) return reply.code(404).send({ error: 'Oportunidade não encontrada.' });
    const b = z.object({ direction: z.enum(['proposta', 'contraproposta']).default('proposta'), amount: z.number().positive('Informe o valor.'), property_id: z.string().uuid().optional(), notes: z.string().optional() }).parse(req.body);
    if (b.property_id && !(await q1('SELECT 1 FROM properties WHERE id=$1 AND org_id=$2', [b.property_id, req.user!.orgId]))) return reply.code(400).send({ error: 'Imóvel não encontrado.' });
    const r = await q1('INSERT INTO proposals(org_id,deal_id,property_id,direction,amount,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [req.user!.orgId, id, b.property_id ?? null, b.direction, b.amount, b.notes ?? null, req.user!.id]);
    await q(`INSERT INTO deal_activities(org_id,deal_id,type,body,user_id) VALUES ($1,$2,'proposta',$3,$4)`, [req.user!.orgId, id, `${b.direction === 'proposta' ? 'Proposta' : 'Contraproposta'} registrada: R$ ${b.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, req.user!.id]);
    await q('UPDATE deals SET updated_at=now() WHERE id=$1', [id]);
    return reply.code(201).send(r);
  });

  app.patch('/api/deals/:id/proposals/:pid', { preHandler: requirePerm('deals.write') }, async (req, reply) => {
    const { id, pid } = req.params as { id: string; pid: string };
    if (!(await loadDeal(req, id))) return reply.code(404).send({ error: 'Oportunidade não encontrada.' });
    const b = z.object({ status: z.enum(['enviada', 'aceita', 'recusada', 'retirada']) }).parse(req.body);
    const r = await q1('UPDATE proposals SET status=$4 WHERE id=$1 AND deal_id=$2 AND org_id=$3 RETURNING *', [pid, id, req.user!.orgId, b.status]);
    if (!r) return reply.code(404).send({ error: 'Proposta não encontrada.' });
    if (b.status === 'aceita') await q('UPDATE deals SET negotiated_value=$2, updated_at=now() WHERE id=$1', [id, r.amount]); // valor negociado ≠ valor fechado
    await q(`INSERT INTO deal_activities(org_id,deal_id,type,body,user_id) VALUES ($1,$2,'proposta',$3,$4)`, [req.user!.orgId, id, `Proposta ${b.status}`, req.user!.id]);
    return r;
  });

  app.post('/api/deals/:id/reservations', { preHandler: requirePerm('deals.write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const d = await loadDeal(req, id);
    if (!d) return reply.code(404).send({ error: 'Oportunidade não encontrada.' });
    const b = z.object({ property_id: z.string().uuid(), expires_at: z.string().datetime({ offset: true }).optional(), notes: z.string().optional() }).parse(req.body);
    const prop = await q1('SELECT id,status FROM properties WHERE id=$1 AND org_id=$2', [b.property_id, req.user!.orgId]);
    if (!prop) return reply.code(400).send({ error: 'Imóvel não encontrado.' });
    if (prop.status !== 'disponivel') return reply.code(409).send({ error: 'Só é possível reservar imóveis disponíveis.' });
    const r = await tx(async (c) => {
      const row = (await c.query('INSERT INTO reservations(org_id,deal_id,property_id,person_id,expires_at,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [req.user!.orgId, id, b.property_id, d.person_id, b.expires_at ?? null, b.notes ?? null, req.user!.id])).rows[0];
      await c.query(`UPDATE properties SET status='reservado', updated_at=now() WHERE id=$1`, [b.property_id]);
      await c.query(`INSERT INTO deal_activities(org_id,deal_id,type,body,user_id) VALUES ($1,$2,'reserva','Imóvel reservado',$3)`, [req.user!.orgId, id, req.user!.id]);
      return row;
    });
    return reply.code(201).send(r);
  });

  app.delete('/api/reservations/:id', { preHandler: requirePerm('deals.write') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await q1(`UPDATE reservations SET status='cancelada' WHERE id=$1 AND org_id=$2 AND status='ativa' RETURNING property_id`, [id, req.user!.orgId]);
    if (!r) return reply.code(404).send({ error: 'Reserva não encontrada.' });
    await q(`UPDATE properties SET status='disponivel', updated_at=now() WHERE id=$1 AND status='reservado'`, [r.property_id]);
    return { ok: true };
  });

  // Tarefas de acompanhamento
  app.get('/api/tasks', { preHandler: requirePerm('deals.read') }, async (req) => {
    const f = z.object({ status: z.enum(['abertas', 'concluidas', 'atrasadas']).default('abertas'), mine: z.enum(['true', 'false']).default('true') }).parse(req.query);
    const params: unknown[] = [req.user!.orgId];
    const where = ['t.org_id=$1'];
    if (f.mine === 'true' || !can(req.user!.role, 'deals.all')) { params.push(req.user!.id); where.push(`t.assignee_user_id=$${params.length}`); }
    where.push(f.status === 'concluidas' ? 't.done_at IS NOT NULL' : f.status === 'atrasadas' ? 't.done_at IS NULL AND t.due_at < now()' : 't.done_at IS NULL');
    return q(`SELECT t.*, p.name AS person_name FROM tasks t LEFT JOIN people p ON p.id=t.person_id WHERE ${where.join(' AND ')} ORDER BY t.due_at NULLS LAST LIMIT 200`, params);
  });
  app.post('/api/tasks', { preHandler: requirePerm('deals.write') }, async (req, reply) => {
    const b = z.object({ title: z.string().trim().min(2), due_at: z.string().datetime({ offset: true }).optional(), person_id: z.string().uuid().optional(), deal_id: z.string().uuid().optional(), assignee_user_id: z.string().uuid().optional() }).parse(req.body);
    if (b.deal_id && !(await loadDeal(req, b.deal_id))) return reply.code(400).send({ error: 'Oportunidade não encontrada.' });
    if (b.person_id && !(await q1('SELECT 1 FROM people WHERE id=$1 AND org_id=$2', [b.person_id, req.user!.orgId]))) return reply.code(400).send({ error: 'Pessoa não encontrada.' });
    const r = await q1('INSERT INTO tasks(org_id,title,due_at,person_id,deal_id,assignee_user_id,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [req.user!.orgId, b.title, b.due_at ?? null, b.person_id ?? null, b.deal_id ?? null, b.assignee_user_id ?? req.user!.id, req.user!.id]);
    return reply.code(201).send(r);
  });
  app.post('/api/tasks/:id/done', { preHandler: requirePerm('deals.write') }, async (req, reply) => {
    const r = await q(`UPDATE tasks SET done_at=now() WHERE id=$1 AND org_id=$2 AND ($3 OR assignee_user_id=$4) RETURNING id`, [(req.params as any).id, req.user!.orgId, can(req.user!.role, 'deals.all'), req.user!.id]);
    if (!r.length) return reply.code(404).send({ error: 'Tarefa não encontrada.' });
    return { ok: true };
  });
}
