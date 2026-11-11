import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { q, q1, tx } from '../db/pool.js';
import { audit, requirePerm } from '../lib/auth.js';

// Controle financeiro dos contratos: parcelas, baixa de pagamentos, reajuste e renovação.
// Não emite boleto, não cobra e não calcula índices oficiais: o percentual do reajuste é informado por quem opera.
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.');
const money = z.number().positive().max(1e9);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const asStr = (d: any) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : String(d).slice(0, 10));
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const todayStr = () => iso(new Date(Date.now() - 3 * 3600_000)); // data civil de Brasília (UTC-3)

/** Vencimentos de um contrato: mensal = todo mês no due_day (limitado ao último dia do mês); anual = aniversários do início; safra = uma parcela no fim do prazo. */
export function schedule(c: { start_date: string; end_date: string; value_period: string; due_day: number | null }): string[] {
  const s = new Date(c.start_date + 'T00:00:00Z'), e = new Date(c.end_date + 'T00:00:00Z');
  const out: string[] = [];
  if (c.value_period === 'safra') return [c.end_date];
  if (c.value_period === 'anual') {
    for (let y = 0; out.length < 100; y++) {
      const last = new Date(Date.UTC(s.getUTCFullYear() + y, s.getUTCMonth() + 1, 0)).getUTCDate();
      const due = new Date(Date.UTC(s.getUTCFullYear() + y, s.getUTCMonth(), Math.min(s.getUTCDate(), last)));
      if (due >= e) break;
      out.push(iso(due));
    }
    return out;
  }
  const dd = c.due_day ?? s.getUTCDate();
  for (let m = 0; out.length < 600; m++) {
    const y = s.getUTCFullYear(), mo = s.getUTCMonth() + m;
    const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    const due = new Date(Date.UTC(y, mo, Math.min(dd, last)));
    if (due >= e) break;
    if (due >= s) out.push(iso(due));
  }
  return out;
}

const STATUS_SQL = `CASE WHEN p.paid_amount IS NOT NULL AND p.paid_amount >= p.amount THEN 'pago' WHEN p.paid_amount IS NOT NULL THEN 'parcial' WHEN p.due_date < $TODAY::date THEN 'atrasado' ELSE 'pendente' END`;
const PAY_SELECT = (todayParam: string) => `SELECT p.id,p.contract_id,p.due_date,p.amount,p.paid_amount,p.paid_at,p.method,p.note,p.generated,${STATUS_SQL.replace('$TODAY', todayParam)} AS status`;

async function loadContract(orgId: string, id: string, c?: PoolClient) {
  const r = c ? (await c.query('SELECT * FROM contracts WHERE id=$1 AND org_id=$2', [id, orgId])).rows[0] : await q1<any>('SELECT * FROM contracts WHERE id=$1 AND org_id=$2', [id, orgId]);
  return r as any | undefined;
}

export async function contractFinanceRoutes(app: FastifyInstance) {
  const idOf = (req: any, k = 'id') => z.string().uuid().parse(req.params[k]);

  app.get('/api/contracts/:id/payments', { preHandler: requirePerm('contracts.read') }, async (req, reply) => {
    const id = idOf(req);
    if (!(await loadContract(req.user!.orgId, id))) return reply.code(404).send({ error: 'Contrato não encontrado.' });
    return q(`${PAY_SELECT('$3')} FROM contract_payments p WHERE p.contract_id=$1 AND p.org_id=$2 ORDER BY p.due_date, p.created_at`, [id, req.user!.orgId, todayStr()]);
  });

  // Gera as parcelas que faltam (idempotente). Só contratos ativos.
  app.post('/api/contracts/:id/payments/generate', { preHandler: requirePerm('contracts.write') }, async (req, reply) => {
    const id = idOf(req);
    const c = await loadContract(req.user!.orgId, id);
    if (!c) return reply.code(404).send({ error: 'Contrato não encontrado.' });
    if (c.status !== 'ativo') return reply.code(409).send({ error: 'Só contratos ativos geram parcelas.' });
    const dates = schedule({ start_date: asStr(c.start_date), end_date: asStr(c.end_date), value_period: c.value_period, due_day: c.due_day });
    let created = 0;
    for (const d of dates) {
      const r = await q(`INSERT INTO contract_payments(org_id,contract_id,due_date,amount,created_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (contract_id,due_date) WHERE generated DO NOTHING RETURNING id`, [req.user!.orgId, id, d, c.value_amount, req.user!.id]);
      created += r.length;
    }
    await audit(req, 'contract.payments.generate', 'contract', id, { created });
    return { created, total: dates.length };
  });

  // Cobrança avulsa (ex.: multa, IPTU, conserto).
  app.post('/api/contracts/:id/payments', { preHandler: requirePerm('contracts.write') }, async (req, reply) => {
    const id = idOf(req);
    const b = z.object({ due_date: date, amount: money, note: z.string().trim().min(2).max(200) }).parse(req.body);
    if (!(await loadContract(req.user!.orgId, id))) return reply.code(404).send({ error: 'Contrato não encontrado.' });
    const row = await q1<any>(`INSERT INTO contract_payments(org_id,contract_id,due_date,amount,note,generated,created_by) VALUES ($1,$2,$3,$4,$5,false,$6) RETURNING id`, [req.user!.orgId, id, b.due_date, b.amount, b.note, req.user!.id]);
    await audit(req, 'contract.payment.create', 'contract_payment', row!.id);
    return reply.code(201).send({ id: row!.id });
  });

  const payRow = async (req: any) => q1<any>('SELECT p.*, c.status AS contract_status FROM contract_payments p JOIN contracts c ON c.id=p.contract_id WHERE p.id=$1 AND p.org_id=$2', [idOf(req, 'pid'), req.user!.orgId]);

  // Baixa (total ou parcial). Registrar de novo substitui a baixa anterior.
  app.post('/api/contract-payments/:pid/pay', { preHandler: requirePerm('contracts.write') }, async (req, reply) => {
    const p = await payRow(req);
    if (!p) return reply.code(404).send({ error: 'Parcela não encontrada.' });
    const b = z.object({ paid_amount: money, paid_at: date.default(todayStr()), method: z.enum(['pix', 'boleto', 'transferencia', 'dinheiro', 'outro']).default('outro'), note: z.string().trim().max(200).optional() }).parse(req.body);
    if (b.paid_at > todayStr()) return reply.code(400).send({ error: 'A data do pagamento não pode ser futura.' });
    if (b.paid_amount > Number(p.amount) * 2) return reply.code(400).send({ error: 'Valor pago muito acima do valor da parcela. Confira o valor.' });
    await q('UPDATE contract_payments SET paid_amount=$2, paid_at=$3, method=$4, note=COALESCE($5,note) WHERE id=$1', [p.id, b.paid_amount, b.paid_at, b.method, b.note ?? null]);
    await audit(req, 'contract.payment.pay', 'contract_payment', p.id, { amount: b.paid_amount });
    return q1(`${PAY_SELECT('$2')} FROM contract_payments p WHERE p.id=$1`, [p.id, todayStr()]);
  });

  app.post('/api/contract-payments/:pid/unpay', { preHandler: requirePerm('contracts.write') }, async (req, reply) => {
    const p = await payRow(req);
    if (!p) return reply.code(404).send({ error: 'Parcela não encontrada.' });
    await q('UPDATE contract_payments SET paid_amount=NULL, paid_at=NULL, method=NULL WHERE id=$1', [p.id]);
    await audit(req, 'contract.payment.unpay', 'contract_payment', p.id);
    return q1(`${PAY_SELECT('$2')} FROM contract_payments p WHERE p.id=$1`, [p.id, todayStr()]);
  });

  app.delete('/api/contract-payments/:pid', { preHandler: requirePerm('contracts.write') }, async (req, reply) => {
    const p = await payRow(req);
    if (!p) return reply.code(404).send({ error: 'Parcela não encontrada.' });
    if (p.paid_amount != null) return reply.code(409).send({ error: 'Desfaça o pagamento antes de excluir a parcela.' });
    await q('DELETE FROM contract_payments WHERE id=$1', [p.id]);
    await audit(req, 'contract.payment.delete', 'contract_payment', p.id);
    return { ok: true };
  });

  // Resumo do mês e inadimplência (todas as parcelas da imobiliária).
  app.get('/api/contract-payments/summary', { preHandler: requirePerm('contracts.read') }, async (req) => {
    const { month } = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }).parse(req.query);
    const m = month ?? todayStr().slice(0, 7);
    const [row] = await q<any>(`SELECT
        COALESCE(SUM(amount) FILTER (WHERE to_char(due_date,'YYYY-MM')=$2),0) AS esperado,
        COALESCE(SUM(LEAST(paid_amount,amount)) FILTER (WHERE to_char(due_date,'YYYY-MM')=$2),0) AS recebido,
        COALESCE(SUM(amount - COALESCE(paid_amount,0)) FILTER (WHERE due_date < $3::date AND (paid_amount IS NULL OR paid_amount < amount)),0) AS em_atraso,
        COUNT(*) FILTER (WHERE due_date < $3::date AND (paid_amount IS NULL OR paid_amount < amount))::int AS parcelas_atrasadas
      FROM contract_payments WHERE org_id=$1`, [req.user!.orgId, m, todayStr()]);
    const late = await q(`SELECT p.id,p.contract_id,p.due_date,p.amount,p.paid_amount, (CURRENT_DATE - p.due_date) AS dias, pr.title AS property_title, COALESCE(t.display_name,t.name) AS counterparty_name
      FROM contract_payments p JOIN contracts c ON c.id=p.contract_id JOIN properties pr ON pr.id=c.property_id JOIN people t ON t.id=c.counterparty_person_id
      WHERE p.org_id=$1 AND p.due_date < $2::date AND (p.paid_amount IS NULL OR p.paid_amount < p.amount) ORDER BY p.due_date LIMIT 50`, [req.user!.orgId, todayStr()]);
    return { month: m, ...row, atrasadas: late };
  });

  app.get('/api/contracts/:id/adjustments', { preHandler: requirePerm('contracts.read') }, async (req, reply) => {
    const id = idOf(req);
    if (!(await loadContract(req.user!.orgId, id))) return reply.code(404).send({ error: 'Contrato não encontrado.' });
    return q('SELECT id,effective_date,index_name,percent,old_amount,new_amount,note,created_at FROM contract_adjustments WHERE contract_id=$1 AND org_id=$2 ORDER BY effective_date DESC, created_at DESC', [id, req.user!.orgId]);
  });

  // Reajuste: novo valor do contrato e das parcelas ainda em aberto a partir da data de vigência.
  app.post('/api/contracts/:id/adjust', { preHandler: requirePerm('contracts.write') }, async (req, reply) => {
    const id = idOf(req);
    const b = z.object({ percent: z.number().min(-50).max(200).refine((n) => n !== 0, 'Informe um percentual diferente de zero.'), effective_date: date, index_name: z.string().trim().max(40).optional(), note: z.string().trim().max(200).optional() }).parse(req.body);
    const out = await tx(async (c) => {
      const cur = (await c.query('SELECT * FROM contracts WHERE id=$1 AND org_id=$2 FOR UPDATE', [id, req.user!.orgId])).rows[0];
      if (!cur) return { code: 404, error: 'Contrato não encontrado.' };
      if (cur.status !== 'ativo') return { code: 409, error: 'Só contratos ativos podem ser reajustados.' };
      if (b.effective_date < asStr(cur.start_date) || b.effective_date >= asStr(cur.end_date)) return { code: 400, error: 'A vigência do reajuste deve estar dentro do prazo do contrato.' };
      const old = Number(cur.value_amount), next = round2(old * (1 + b.percent / 100));
      if (next <= 0) return { code: 400, error: 'O reajuste resultaria em valor zerado.' };
      await c.query('UPDATE contracts SET value_amount=$2, updated_at=now() WHERE id=$1', [id, next]);
      const upd = await c.query(`UPDATE contract_payments SET amount=ROUND(amount*(1+$3::numeric/100),2) WHERE contract_id=$1 AND generated AND paid_amount IS NULL AND due_date >= $2::date`, [id, b.effective_date, b.percent]);
      await c.query('INSERT INTO contract_adjustments(org_id,contract_id,effective_date,index_name,percent,old_amount,new_amount,note,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [req.user!.orgId, id, b.effective_date, b.index_name ?? cur.adjustment_index ?? null, b.percent, old, next, b.note ?? null, req.user!.id]);
      return { code: 200, old_amount: old, new_amount: next, parcelas_atualizadas: upd.rowCount ?? 0 };
    });
    if (out.code !== 200) return reply.code(out.code).send({ error: (out as any).error });
    await audit(req, 'contract.adjust', 'contract', id, { percent: b.percent });
    return out;
  });

  // Renovação: encerra o contrato atual ("Renovado") e cria o novo já ativo, ligado ao anterior; o imóvel continua alugado/arrendado.
  app.post('/api/contracts/:id/renew', { preHandler: requirePerm('contracts.write') }, async (req, reply) => {
    const id = idOf(req);
    const b = z.object({ new_end_date: date, percent: z.number().min(-50).max(200).optional(), value_amount: money.optional(), notes: z.string().trim().max(500).optional() }).parse(req.body);
    if (b.percent != null && b.value_amount != null) return reply.code(400).send({ error: 'Informe o percentual OU o novo valor, não os dois.' });
    const out = await tx(async (c) => {
      const cur = (await c.query('SELECT * FROM contracts WHERE id=$1 AND org_id=$2 FOR UPDATE', [id, req.user!.orgId])).rows[0];
      if (!cur) return { code: 404, error: 'Contrato não encontrado.' };
      if (cur.status !== 'ativo') return { code: 409, error: 'Só contratos ativos podem ser renovados.' };
      const start = asStr(cur.end_date);
      if (b.new_end_date <= start) return { code: 400, error: 'O novo prazo deve terminar depois do fim do contrato atual.' };
      const value = b.value_amount ?? (b.percent != null ? round2(Number(cur.value_amount) * (1 + b.percent / 100)) : Number(cur.value_amount));
      const row = (await c.query(
        `INSERT INTO contracts(org_id,kind,status,property_id,owner_person_id,counterparty_person_id,start_date,end_date,value_amount,value_period,due_day,deposit,adjustment_index,adjustment_month,guarantee,rural_area_ha,rural_notes,notes,renewed_from,created_by)
         VALUES ($1,$2,'ativo',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
        [cur.org_id, cur.kind, cur.property_id, cur.owner_person_id, cur.counterparty_person_id, start, b.new_end_date, value, cur.value_period, cur.due_day, cur.deposit, cur.adjustment_index, cur.adjustment_month, cur.guarantee, cur.rural_area_ha, cur.rural_notes, b.notes ?? cur.notes, cur.id, req.user!.id])).rows[0];
      await c.query(`UPDATE contracts SET status='encerrado', closed_reason='Renovado', updated_at=now() WHERE id=$1`, [id]);
      const dates = schedule({ start_date: start, end_date: b.new_end_date, value_period: cur.value_period, due_day: cur.due_day });
      for (const d of dates) await c.query('INSERT INTO contract_payments(org_id,contract_id,due_date,amount,created_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (contract_id,due_date) WHERE generated DO NOTHING', [cur.org_id, row.id, d, value, req.user!.id]);
      return { code: 201, id: row.id as string, value_amount: value, parcelas: dates.length };
    });
    if (out.code !== 201) return reply.code(out.code).send({ error: (out as any).error });
    await audit(req, 'contract.renew', 'contract', id, { new_contract: out.id });
    return reply.code(201).send(out);
  });
}
