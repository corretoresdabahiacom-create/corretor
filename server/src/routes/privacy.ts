import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { q, q1, tx } from '../db/pool.js';
import { audit, requirePerm } from '../lib/auth.js';
import { storage } from '../lib/storage.js';

// Ferramentas de privacidade (LGPD): exportar os dados de um titular, anonimizá-lo e apagar contatos antigos do site.
// São ferramentas operacionais; a política e o enquadramento jurídico dependem de revisão por advogado (ver docs/LGPD.md).
export const ANON_NAME = 'Titular anonimizado';

export async function privacyRoutes(app: FastifyInstance) {
  const pid = (req: any) => z.string().uuid().parse(req.params.id);

  // Cópia dos dados que a imobiliária guarda sobre a pessoa (JSON). Não inclui o conteúdo dos arquivos, só a lista.
  app.get('/api/people/:id/export', { preHandler: requirePerm('data.export') }, async (req, reply) => {
    const org = req.user!.orgId, id = pid(req);
    const person = await q1<any>(`SELECT to_jsonb(p) - 'org_id' AS j, p.emails, p.phones FROM people p WHERE p.id=$1 AND p.org_id=$2`, [id, org]);
    if (!person) return reply.code(404).send({ error: 'Pessoa não encontrada.' });
    const rows = (sql: string, extra: unknown[] = []) => q<any>(sql, [org, id, ...extra]).then((r) => r.map((x) => x.j));
    const deals = await rows(`SELECT to_jsonb(d) - 'org_id' AS j FROM deals d WHERE d.org_id=$1 AND d.person_id=$2 ORDER BY d.created_at`);
    const dealIds = deals.map((d: any) => d.id);
    const out = {
      gerado_em: new Date().toISOString(),
      aviso: 'Dados mantidos por esta imobiliária sobre o titular. Conteúdo dos arquivos anexados não está incluído (apenas a lista). Textos livres de outras pessoas podem ter sido omitidos.',
      pessoa: person.j,
      interacoes: await rows(`SELECT to_jsonb(i) - 'org_id' AS j FROM person_interactions i WHERE i.person_id=$2 AND EXISTS (SELECT 1 FROM people p WHERE p.id=i.person_id AND p.org_id=$1) ORDER BY i.created_at`),
      negocios: deals,
      atividades_dos_negocios: dealIds.length ? (await q<any>(`SELECT to_jsonb(a) - 'org_id' AS j FROM deal_activities a WHERE a.org_id=$1 AND a.deal_id = ANY($2::uuid[]) ORDER BY a.created_at`, [org, dealIds])).map((x) => x.j) : [],
      propostas: dealIds.length ? (await q<any>(`SELECT to_jsonb(pr) - 'org_id' AS j FROM proposals pr WHERE pr.org_id=$1 AND pr.deal_id = ANY($2::uuid[])`, [org, dealIds])).map((x) => x.j) : [],
      reservas: await rows(`SELECT to_jsonb(r) - 'org_id' AS j FROM reservations r WHERE r.org_id=$1 AND r.person_id=$2`),
      tarefas: await rows(`SELECT to_jsonb(t) - 'org_id' AS j FROM tasks t WHERE t.org_id=$1 AND t.person_id=$2`),
      eventos: await rows(`SELECT to_jsonb(e) - 'org_id' AS j FROM events e WHERE e.org_id=$1 AND e.person_id=$2`),
      arquivos: await rows(`SELECT to_jsonb(f) - 'org_id' - 'storage_key' AS j FROM files f WHERE f.org_id=$1 AND f.person_id=$2`),
      contratos: await rows(`SELECT to_jsonb(c) - 'org_id' AS j FROM contracts c WHERE c.org_id=$1 AND (c.owner_person_id=$2 OR c.counterparty_person_id=$2)`),
      imoveis_como_proprietario: await rows(`SELECT jsonb_build_object('codigo', p.code, 'titulo', p.title, 'status', p.status) AS j FROM properties p WHERE p.org_id=$1 AND p.owner_person_id=$2`),
      contatos_do_site: (await q<any>(`SELECT to_jsonb(l) - 'org_id' - 'ip_hash' AS j FROM portal_leads l WHERE l.org_id=$1 AND (l.person_id=$2 OR (l.email IS NOT NULL AND l.email = ANY($3::text[])) OR (l.phone IS NOT NULL AND l.phone = ANY($4::text[]))) ORDER BY l.created_at`, [org, id, person.emails ?? [], person.phones ?? []])).map((x) => x.j),
    };
    await audit(req, 'person.export', 'person', id);
    return reply.header('content-type', 'application/json; charset=utf-8').header('content-disposition', `attachment; filename="titular-${id.slice(0, 8)}.json"`).header('cache-control', 'no-store').send(JSON.stringify(out, null, 2));
  });

  // Anonimização irreversível: remove identificação, interações e documentos da pessoa e os contatos do site ligados a ela.
  // Mantém negócios/contratos (obrigações legais e contábeis), sem identificar o titular.
  app.post('/api/people/:id/anonymize', { preHandler: requirePerm('org.manage') }, async (req, reply) => {
    const org = req.user!.orgId, id = pid(req);
    const b = z.object({ confirm: z.string() }).parse(req.body);
    if (b.confirm.trim().toUpperCase() !== 'ANONIMIZAR') return reply.code(400).send({ error: 'Digite ANONIMIZAR para confirmar.' });
    let keys: string[] = [];
    const res = await tx(async (c) => {
      const p = (await c.query('SELECT * FROM people WHERE id=$1 AND org_id=$2 FOR UPDATE', [id, org])).rows[0];
      if (!p) return { code: 404, error: 'Pessoa não encontrada.' };
      const active = (await c.query(`SELECT 1 FROM contracts WHERE org_id=$1 AND status='ativo' AND (owner_person_id=$2 OR counterparty_person_id=$2) LIMIT 1`, [org, id])).rowCount;
      if (active) return { code: 409, error: 'Esta pessoa tem contrato ativo. Encerre ou renove o contrato antes de anonimizar.' };
      keys = (await c.query('SELECT storage_key FROM files WHERE org_id=$1 AND person_id=$2', [org, id])).rows.map((r) => r.storage_key);
      await c.query('DELETE FROM files WHERE org_id=$1 AND person_id=$2', [org, id]);
      await c.query('DELETE FROM person_interactions WHERE person_id=$1', [id]);
      const leads = await c.query(`DELETE FROM portal_leads WHERE org_id=$1 AND (person_id=$2 OR (email IS NOT NULL AND email = ANY($3::text[])) OR (phone IS NOT NULL AND phone = ANY($4::text[])))`, [org, id, p.emails ?? [], p.phones ?? []]);
      await c.query(`UPDATE people SET name=$3, display_name=NULL, document=NULL, document_norm=NULL, phones='{}', emails='{}', address='{}'::jsonb, contact_pref=NULL, source=NULL, private_notes=NULL, consent='{}'::jsonb, profile='{}'::jsonb, relationship_status='inativo', archived_at=COALESCE(archived_at, now()), updated_by=$4, updated_at=now() WHERE id=$1 AND org_id=$2`, [id, org, ANON_NAME, req.user!.id]);
      return { code: 200, contatos_do_site_apagados: leads.rowCount ?? 0 };
    });
    if (res.code !== 200) return reply.code(res.code).send({ error: (res as any).error });
    for (const k of keys) await storage().del(k).catch((e) => req.log.warn({ err: String(e) }, 'falha ao apagar arquivo na anonimização'));
    await audit(req, 'person.anonymize', 'person', id, { arquivos_apagados: keys.length });
    return {
      ok: true, arquivos_apagados: keys.length, contatos_do_site_apagados: (res as any).contatos_do_site_apagados,
      avisos: ['Textos livres de tarefas, eventos, negócios e propostas não são reescritos: revise se citam o nome da pessoa.', 'Cópias de segurança (backups) mantêm os dados até expirarem.'],
    };
  });

  // Retenção: apaga contatos do site (não convertidos em cliente) mais antigos que N dias.
  app.post('/api/privacy/purge-leads', { preHandler: requirePerm('org.manage') }, async (req) => {
    const b = z.object({ older_than_days: z.number().int().min(30).max(3650).default(365) }).parse(req.body ?? {});
    const r = await q<{ id: string }>(`DELETE FROM portal_leads WHERE org_id=$1 AND status<>'convertido' AND created_at < now() - ($2::int * interval '1 day') RETURNING id`, [req.user!.orgId, b.older_than_days]);
    await audit(req, 'privacy.purge_leads', 'portal_leads', undefined, { older_than_days: b.older_than_days, apagados: r.length });
    return { apagados: r.length, older_than_days: b.older_than_days };
  });
}
