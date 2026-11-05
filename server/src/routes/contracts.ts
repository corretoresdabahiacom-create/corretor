import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { q, q1, tx } from '../db/pool.js';
import { audit, requirePerm } from '../lib/auth.js';

// Registro de contratos para CONTROLE (prazos, valores, reajuste). Não gera nem valida texto jurídico.
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.');
const body = z.object({
  kind: z.enum(['locacao', 'arrendamento']),
  property_id: z.string().uuid(),
  owner_person_id: z.string().uuid(),
  counterparty_person_id: z.string().uuid(),
  start_date: date, end_date: date,
  value_amount: z.number().nonnegative(),
  value_period: z.enum(['mensal', 'anual', 'safra']).default('mensal'),
  due_day: z.number().int().min(1).max(31).nullable().optional(),
  deposit: z.number().nonnegative().nullable().optional(),
  adjustment_index: z.string().max(40).nullable().optional(),
  adjustment_month: z.number().int().min(1).max(12).nullable().optional(),
  guarantee: z.string().max(200).nullable().optional(),
  rural_area_ha: z.number().positive().nullable().optional(),
  rural_notes: z.string().max(2000).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

async function refsProblem(orgId: string, b: z.infer<typeof body>) {
  if (b.end_date <= b.start_date) return 'A data final deve ser depois da inicial.';
  if (b.owner_person_id === b.counterparty_person_id) return 'Proprietário e outra parte não podem ser a mesma pessoa.';
  if (!(await q1('SELECT 1 FROM properties WHERE id=$1 AND org_id=$2', [b.property_id, orgId]))) return 'Imóvel não encontrado.';
  const n = await q1<{ n: number }>('SELECT count(*)::int n FROM people WHERE org_id=$1 AND id = ANY($2::uuid[])', [orgId, [b.owner_person_id, b.counterparty_person_id]]);
  if ((n?.n ?? 0) !== 2) return 'Pessoa não encontrada.';
  if (b.kind === 'arrendamento' && !(await q1(`SELECT 1 FROM properties WHERE id=$1 AND kind='rural'`, [b.property_id]))) return 'Arrendamento rural exige imóvel rural.';
  return null;
}

const SELECT = `SELECT c.*, p.title AS property_title, p.code AS property_code, COALESCE(o.display_name,o.name) AS owner_name, COALESCE(t.display_name,t.name) AS counterparty_name
  FROM contracts c JOIN properties p ON p.id=c.property_id JOIN people o ON o.id=c.owner_person_id JOIN people t ON t.id=c.counterparty_person_id`;

export async function contractRoutes(app: FastifyInstance) {
  app.get('/api/contracts', { preHandler: requirePerm('contracts.read') }, async (req) => {
    const f = z.object({ status: z.string().optional(), kind: z.string().optional(), property_id: z.string().uuid().optional() }).parse(req.query);
    return q(`${SELECT} WHERE c.org_id=$1 AND ($2::text IS NULL OR c.status=$2) AND ($3::text IS NULL OR c.kind=$3) AND ($4::uuid IS NULL OR c.property_id=$4) ORDER BY c.end_date`,
      [req.user!.orgId, f.status ?? null, f.kind ?? null, f.property_id ?? null]);
  });

  // Alertas de prazo: vencimentos (30/60/90 dias), vencidos ainda ativos e reajustes próximos.
  app.get('/api/contracts/alerts', { preHandler: requirePerm('contracts.read') }, async (req) => {
    const rows = await q<any>(`${SELECT} WHERE c.org_id=$1 AND c.status='ativo' ORDER BY c.end_date`, [req.user!.orgId]);
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const day = 86400000;
    const out: any[] = [];
    for (const c of rows) {
      const endStr = c.end_date instanceof Date ? `${c.end_date.getFullYear()}-${String(c.end_date.getMonth() + 1).padStart(2, '0')}-${String(c.end_date.getDate()).padStart(2, '0')}` : String(c.end_date).slice(0, 10);
      const end = new Date(endStr + 'T00:00:00Z');
      const days = Math.round((end.getTime() - today.getTime()) / day);
      const base = { contract_id: c.id, kind: c.kind, property_title: c.property_title, counterparty_name: c.counterparty_name };
      if (days < 0) out.push({ ...base, type: 'vencido', severity: 'alta', days, message: `Contrato venceu há ${-days} dia(s) e continua ativo.` });
      else if (days <= 90) out.push({ ...base, type: 'vencimento', severity: days <= 30 ? 'alta' : days <= 60 ? 'media' : 'baixa', days, message: `Vence em ${days} dia(s).` });
      if (c.adjustment_month) {
        let next = new Date(Date.UTC(today.getUTCFullYear(), c.adjustment_month - 1, 1));
        if (next < today) next = new Date(Date.UTC(today.getUTCFullYear() + 1, c.adjustment_month - 1, 1));
        const d = Math.round((next.getTime() - today.getTime()) / day);
        if (d <= 60 && next < end) out.push({ ...base, type: 'reajuste', severity: 'baixa', days: d, message: `Reajuste${c.adjustment_index ? ' (' + c.adjustment_index + ')' : ''} no mês ${c.adjustment_month}, em ~${d} dia(s).` });
      }
    }
    return out.sort((a, b) => a.days - b.days);
  });

  app.get('/api/contracts/:id', { preHandler: requirePerm('contracts.read') }, async (req, reply) => {
    const id = z.string().uuid().safeParse((req.params as any).id);
    const c = id.success ? await q1(`${SELECT} WHERE c.id=$1 AND c.org_id=$2`, [id.data, req.user!.orgId]) : null;
    return c ?? reply.code(404).send({ error: 'Contrato não encontrado.' });
  });

  app.post('/api/contracts', { preHandler: requirePerm('contracts.write') }, async (req, reply) => {
    const b = body.parse(req.body);
    const prob = await refsProblem(req.user!.orgId, b);
    if (prob) return reply.code(400).send({ error: prob });
    const row = await q1<any>(
      `INSERT INTO contracts(org_id,kind,property_id,owner_person_id,counterparty_person_id,start_date,end_date,value_amount,value_period,due_day,deposit,adjustment_index,adjustment_month,guarantee,rural_area_ha,rural_notes,notes,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
      [req.user!.orgId, b.kind, b.property_id, b.owner_person_id, b.counterparty_person_id, b.start_date, b.end_date, b.value_amount, b.value_period, b.due_day ?? null, b.deposit ?? null, b.adjustment_index ?? null, b.adjustment_month ?? null, b.guarantee ?? null, b.rural_area_ha ?? null, b.rural_notes ?? null, b.notes ?? null, req.user!.id]);
    await audit(req, 'contract.create', 'contract', row!.id);
    return reply.code(201).send(await q1(`${SELECT} WHERE c.id=$1`, [row!.id]));
  });

  app.patch('/api/contracts/:id', { preHandler: requirePerm('contracts.write') }, async (req, reply) => {
    const id = z.string().uuid().parse((req.params as any).id);
    const cur = await q1<any>('SELECT * FROM contracts WHERE id=$1 AND org_id=$2', [id, req.user!.orgId]);
    if (!cur) return reply.code(404).send({ error: 'Contrato não encontrado.' });
    if (cur.status !== 'rascunho' && cur.status !== 'ativo') return reply.code(409).send({ error: 'Contrato encerrado não pode ser editado.' });
    const norm = (d: any) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);
    const b = body.parse({ ...cur, start_date: norm(cur.start_date), end_date: norm(cur.end_date), value_amount: Number(cur.value_amount), deposit: cur.deposit == null ? null : Number(cur.deposit), rural_area_ha: cur.rural_area_ha == null ? null : Number(cur.rural_area_ha), ...(req.body as object) });
    const prob = await refsProblem(req.user!.orgId, b);
    if (prob) return reply.code(400).send({ error: prob });
    await q(`UPDATE contracts SET kind=$3,property_id=$4,owner_person_id=$5,counterparty_person_id=$6,start_date=$7,end_date=$8,value_amount=$9,value_period=$10,due_day=$11,deposit=$12,adjustment_index=$13,adjustment_month=$14,guarantee=$15,rural_area_ha=$16,rural_notes=$17,notes=$18,updated_at=now() WHERE id=$1 AND org_id=$2`,
      [id, req.user!.orgId, b.kind, b.property_id, b.owner_person_id, b.counterparty_person_id, b.start_date, b.end_date, b.value_amount, b.value_period, b.due_day ?? null, b.deposit ?? null, b.adjustment_index ?? null, b.adjustment_month ?? null, b.guarantee ?? null, b.rural_area_ha ?? null, b.rural_notes ?? null, b.notes ?? null]);
    await audit(req, 'contract.update', 'contract', id);
    return q1(`${SELECT} WHERE c.id=$1`, [id]);
  });

  app.post('/api/contracts/:id/activate', { preHandler: requirePerm('contracts.write') }, async (req, reply) => {
    const id = z.string().uuid().parse((req.params as any).id);
    const out = await tx(async (c) => {
      const cur = (await c.query('SELECT * FROM contracts WHERE id=$1 AND org_id=$2 FOR UPDATE', [id, req.user!.orgId])).rows[0];
      if (!cur) return { code: 404, error: 'Contrato não encontrado.' };
      if (cur.status !== 'rascunho') return { code: 409, error: 'Só contratos em rascunho podem ser ativados.' };
      const overlap = (await c.query(`SELECT id FROM contracts WHERE org_id=$1 AND property_id=$2 AND status='ativo' AND id<>$3 AND start_date < $5::date AND end_date > $4::date`, [req.user!.orgId, cur.property_id, id, cur.start_date, cur.end_date])).rows[0];
      if (overlap) return { code: 409, error: 'Já existe contrato ativo para este imóvel no mesmo período.', conflict_id: overlap.id };
      await c.query(`UPDATE contracts SET status='ativo', updated_at=now() WHERE id=$1`, [id]);
      await c.query(`UPDATE properties SET status=$2, updated_at=now() WHERE id=$1`, [cur.property_id, cur.kind === 'locacao' ? 'alugado' : 'arrendado']);
      return { code: 200 };
    });
    if (out.code !== 200) return reply.code(out.code).send(out);
    await audit(req, 'contract.activate', 'contract', id);
    return q1(`${SELECT} WHERE c.id=$1`, [id]);
  });

  app.post('/api/contracts/:id/close', { preHandler: requirePerm('contracts.write') }, async (req, reply) => {
    const id = z.string().uuid().parse((req.params as any).id);
    const b = z.object({ status: z.enum(['encerrado', 'rescindido']), reason: z.string().trim().min(3, 'Informe o motivo.'), release_property: z.boolean().default(true) }).parse(req.body);
    const out = await tx(async (c) => {
      const cur = (await c.query('SELECT * FROM contracts WHERE id=$1 AND org_id=$2 FOR UPDATE', [id, req.user!.orgId])).rows[0];
      if (!cur) return 404;
      if (cur.status !== 'ativo') return 409;
      await c.query(`UPDATE contracts SET status=$2, closed_reason=$3, updated_at=now() WHERE id=$1`, [id, b.status, b.reason]);
      if (b.release_property) await c.query(`UPDATE properties SET status='disponivel', updated_at=now() WHERE id=$1 AND status IN ('alugado','arrendado')`, [cur.property_id]);
      return 200;
    });
    if (out === 404) return reply.code(404).send({ error: 'Contrato não encontrado.' });
    if (out === 409) return reply.code(409).send({ error: 'Só contratos ativos podem ser encerrados.' });
    await audit(req, 'contract.close', 'contract', id, { status: b.status });
    return q1(`${SELECT} WHERE c.id=$1`, [id]);
  });
}
