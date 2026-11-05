import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { q, q1 } from '../db/pool.js';
import { audit, requirePerm } from '../lib/auth.js';
import { can } from '../lib/permissions.js';

const csvCell = (v: unknown) => {
  let s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita injeção de fórmula em planilhas
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows: Record<string, unknown>[]) => {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  return '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n');
};

export async function insightRoutes(app: FastifyInstance) {
  // Painel inicial: tudo calculado a partir dos dados reais
  app.get('/api/dashboard', { preHandler: requirePerm('events.read') }, async (req) => {
    const o = req.user!.orgId;
    const u = req.user!.id;
    const all = can(req.user!.role, 'events.all');
    const seeDeals = can(req.user!.role, 'deals.read');
    const dealsAll = can(req.user!.role, 'deals.all');
    const evScope = all ? '' : `AND (e.owner_user_id='${u}' OR '${u}'=ANY(e.participants))`; // u vem da sessão (uuid), não de entrada do usuário
    const dealScope = dealsAll ? '' : `AND d.owner_user_id='${u}'`;
    const [today, upcoming, waiting, newContacts, proposals, available, overdue, summary] = await Promise.all([
      q(`SELECT e.id,e.title,e.type,e.starts_at,e.ends_at,e.location FROM events e WHERE e.org_id=$1 AND e.status='agendado' AND e.starts_at::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date ${evScope} ORDER BY e.starts_at`, [o]),
      q(`SELECT e.id,e.title,e.starts_at,pr.title AS property_title,p.name AS person_name FROM events e LEFT JOIN properties pr ON pr.id=e.property_id LEFT JOIN people p ON p.id=e.person_id WHERE e.org_id=$1 AND e.type='visita' AND e.status='agendado' AND e.starts_at>now() ${evScope} ORDER BY e.starts_at LIMIT 8`, [o]),
      q(`SELECT id,name,updated_at FROM people WHERE org_id=$1 AND archived_at IS NULL AND relationship_status='aguardando_retorno' ORDER BY updated_at LIMIT 8`, [o]),
      q(`SELECT id,name,source,created_at FROM people WHERE org_id=$1 AND archived_at IS NULL AND created_at > now() - interval '7 days' ORDER BY created_at DESC LIMIT 8`, [o]),
      seeDeals ? q(`SELECT d.id,d.estimated_value,d.negotiated_value,d.stage_key,p.name AS person_name FROM deals d JOIN people p ON p.id=d.person_id WHERE d.org_id=$1 AND d.stage_key IN ('proposta','negociacao') ${dealScope} ORDER BY d.updated_at DESC LIMIT 8`, [o]) : [],
      q1(`SELECT count(*)::int n FROM properties WHERE org_id=$1 AND status='disponivel'`, [o]),
      seeDeals ? q(`SELECT id,title,due_at FROM tasks WHERE org_id=$1 AND done_at IS NULL AND due_at < now() AND assignee_user_id=$2 ORDER BY due_at LIMIT 8`, [o, u]) : [],
      seeDeals ? q1(
        `SELECT count(*) FILTER (WHERE s.kind='aberta')::int AS open_deals,
                coalesce(sum(d.estimated_value) FILTER (WHERE s.kind='aberta'),0) AS open_estimated,
                count(*) FILTER (WHERE s.kind='ganha' AND d.closed_at >= date_trunc('month', now()))::int AS won_month,
                coalesce(sum(d.closed_value) FILTER (WHERE s.kind='ganha' AND d.closed_at >= date_trunc('month', now())),0) AS won_month_value,
                count(*) FILTER (WHERE s.kind='perdida' AND d.closed_at >= date_trunc('month', now()))::int AS lost_month
           FROM deals d JOIN pipeline_stages s ON s.org_id=d.org_id AND s.key=d.stage_key WHERE d.org_id=$1 ${dealScope}`, [o]) : null,
    ]);
    // contratos próximos do vencimento: módulo da Fase 2 (ainda não implementado)
    return { today, upcoming, waiting, newContacts, proposals, availableProperties: available.n, overdueTasks: overdue, summary, contractsExpiring: { available: false, note: 'Módulo de contratos previsto para a Fase 2.' } };
  });

  // Busca global
  app.get('/api/search', { preHandler: requirePerm('people.read') }, async (req) => {
    const { q: term } = z.object({ q: z.string().trim().min(2).max(80) }).parse(req.query);
    const o = req.user!.orgId;
    const like = `%${term}%`;
    const [people, props, deals] = await Promise.all([
      q(`SELECT id,name,roles FROM people WHERE org_id=$1 AND archived_at IS NULL AND (name ILIKE $2 OR display_name ILIKE $2 OR EXISTS (SELECT 1 FROM unnest(emails) e WHERE e ILIKE $2)) LIMIT 6`, [o, like]),
      can(req.user!.role, 'properties.read') ? q(`SELECT id,code,title,status,city FROM properties WHERE org_id=$1 AND status<>'arquivado' AND (code ILIKE $2 OR title ILIKE $2 OR city ILIKE $2 OR neighborhood ILIKE $2) LIMIT 6`, [o, like]) : [],
      can(req.user!.role, 'deals.read')
        ? q(`SELECT d.id,d.stage_key,p.name AS person_name FROM deals d JOIN people p ON p.id=d.person_id WHERE d.org_id=$1 AND p.name ILIKE $2 ${can(req.user!.role, 'deals.all') ? '' : 'AND d.owner_user_id=$3'} LIMIT 6`, can(req.user!.role, 'deals.all') ? [o, like] : [o, like, req.user!.id])
        : [],
    ]);
    return { people, properties: props, deals };
  });

  // ---- Relatórios ----
  const range = z.object({ from: z.string().optional(), to: z.string().optional() });
  const period = (r: { from?: string; to?: string }) => ({ from: r.from ?? '1970-01-01', to: r.to ?? '2999-12-31' });

  async function buildReport(name: string, req: any) {
    const o = req.user!.orgId;
    const { from, to } = period(range.parse(req.query));
    const dealsAll = can(req.user!.role, 'deals.all');
    const scope = dealsAll ? '' : `AND d.owner_user_id='${req.user!.id}'`;
    switch (name) {
      case 'imoveis-status':
        return q(`SELECT status, coalesce(unnest_purpose,'(sem finalidade)') AS finalidade, count(*)::int AS total FROM properties p LEFT JOIN LATERAL unnest(p.purposes) AS unnest_purpose ON true WHERE p.org_id=$1 GROUP BY 1,2 ORDER BY 1,2`, [o]);
      case 'captacao':
        return q(`SELECT to_char(date_trunc('month', captured_at),'YYYY-MM') AS mes, count(*)::int AS imoveis FROM properties WHERE org_id=$1 AND captured_at BETWEEN $2 AND $3 GROUP BY 1 ORDER BY 1`, [o, from, to]);
      case 'leads-origem':
        return q(`SELECT coalesce(source,'(não informado)') AS origem, count(*)::int AS total FROM people WHERE org_id=$1 AND archived_at IS NULL AND created_at::date BETWEEN $2 AND $3 GROUP BY 1 ORDER BY 2 DESC`, [o, from, to]);
      case 'conversao-etapa':
        return q(
          `SELECT s.label AS etapa, s.position, count(DISTINCT h.deal_id)::int AS oportunidades_que_chegaram
             FROM pipeline_stages s LEFT JOIN deal_stage_history h ON h.org_id=s.org_id AND h.to_stage=s.key
             LEFT JOIN deals d ON d.id=h.deal_id
            WHERE s.org_id=$1 AND (h.deal_id IS NULL OR (d.created_at::date BETWEEN $2 AND $3 ${scope.replace('d.owner_user_id', 'd.owner_user_id')}))
            GROUP BY s.label, s.position ORDER BY s.position`, [o, from, to]);
      case 'visitas':
        return q(`SELECT status, count(*)::int AS total FROM events e WHERE org_id=$1 AND type='visita' AND starts_at::date BETWEEN $2 AND $3 ${dealsAll ? '' : `AND owner_user_id='${req.user!.id}'`} GROUP BY status`, [o, from, to]);
      case 'propostas-andamento':
        return q(`SELECT d.id AS oportunidade, p.name AS pessoa, d.purpose AS finalidade, d.estimated_value AS valor_estimado, d.negotiated_value AS valor_negociado FROM deals d JOIN people p ON p.id=d.person_id WHERE d.org_id=$1 AND d.stage_key IN ('proposta','negociacao') ${scope}`, [o]);
      case 'concluidos':
        return q(`SELECT d.purpose AS finalidade, count(*)::int AS concluidos, coalesce(sum(d.closed_value),0) AS valor_fechado FROM deals d JOIN pipeline_stages s ON s.org_id=d.org_id AND s.key=d.stage_key WHERE d.org_id=$1 AND s.kind='ganha' AND d.closed_at::date BETWEEN $2 AND $3 ${scope} GROUP BY 1`, [o, from, to]);
      case 'atividades-corretor':
        if (!can(req.user!.role, 'reports.all')) return q(`SELECT u.name AS corretor, (SELECT count(*)::int FROM deal_activities a WHERE a.user_id=u.id AND a.created_at::date BETWEEN $2 AND $3) AS atividades FROM users u WHERE u.id=$1`, [req.user!.id, from, to]);
        return q(`SELECT u.name AS corretor, count(a.id)::int AS atividades FROM users u LEFT JOIN deal_activities a ON a.user_id=u.id AND a.created_at::date BETWEEN $2 AND $3 WHERE u.org_id=$1 AND u.active GROUP BY u.name ORDER BY 2 DESC`, [o, from, to]);
      case 'tempo-medio': {
        const r = await q1(`SELECT count(*)::int AS n, avg(extract(epoch FROM (d.closed_at - d.created_at))/86400) AS dias FROM deals d JOIN pipeline_stages s ON s.org_id=d.org_id AND s.key=d.stage_key WHERE d.org_id=$1 AND s.kind='ganha' AND d.closed_at::date BETWEEN $2 AND $3 ${scope}`, [o, from, to]);
        // sem amostra, não inventa número
        return [{ negocios_concluidos: r.n, dias_medios_ate_fechar: r.n >= 1 ? Math.round(r.dias * 10) / 10 : null, observacao: r.n < 1 ? 'Dados insuficientes' : r.n < 5 ? 'Amostra pequena' : '' }];
      }
      default:
        return null;
    }
  }

  app.get('/api/reports/:name', { preHandler: requirePerm('reports.read') }, async (req, reply) => {
    const rows = await buildReport((req.params as any).name, req);
    if (rows === null) return reply.code(404).send({ error: 'Relatório inexistente.' });
    return { rows, insufficient: rows.length === 0 };
  });

  app.get('/api/reports/:name/export.csv', { preHandler: requirePerm('data.export') }, async (req, reply) => {
    const name = (req.params as any).name;
    const rows = await buildReport(name, req);
    if (rows === null) return reply.code(404).send({ error: 'Relatório inexistente.' });
    await audit(req, 'report.export', 'report', undefined, { name });
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${name}.csv"`);
    return toCsv(rows);
  });
}
