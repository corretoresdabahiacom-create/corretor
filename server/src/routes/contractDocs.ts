// Documentos de contrato gerados de modelos: ficam na pasta do cliente, só para quem tem permissão `docs.contracts`
// (administrador, gestor e corretor). Permitem editar, copiar, excluir, voltar a uma versão e compartilhar por link com validade.
import type { FastifyInstance } from '../http/mini.js';
import { z } from 'zod';
import { q, q1, tx } from '../db/pool.js';
import { audit, hashToken, newToken, requirePerm } from '../lib/auth.js';
import { config } from '../lib/config.js';
import { CATEGORY_LABEL, SOURCES, SOURCE_CHECKED, TEMPLATES, defaults, templateByKey, type Data, type Template } from '../lib/docTemplates.js';
import { normalizeIndex } from '../lib/indices.js';

const rl = (max: number, timeWindow: string) => ({ config: { rateLimit: process.env.RATE_LIMIT_DISABLED === 'true' ? false : { max, timeWindow } } });
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const todayStr = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const asStr = (d: any) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : String(d ?? '').slice(0, 10));
const MAX_VERSIONS = 30;

function fmtDoc(v?: string | null) {
  const d = (v ?? '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return v ?? '';
}
const addr = (a: any) => [a?.logradouro && `${a.logradouro}${a.numero ? ', ' + a.numero : ''}`, a?.complemento, a?.bairro, a?.cidade && `${a.cidade}${a.uf ? '/' + a.uf : ''}`, a?.cep && `CEP ${a.cep}`].filter(Boolean).join(', ');
const phoneFmt = (t: string) => { const d = t.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, ''); return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : t; };
const personData = (p: any, k: string): Data => ({
  [`${k}_nome`]: p.name, [`${k}_doc`]: fmtDoc(p.document), [`${k}_end`]: addr(p.address),
  [`${k}_contato`]: [p.phones?.[0] && phoneFmt(p.phones[0]), p.emails?.[0]].filter(Boolean).join(' / '),
});
const INDEX_LABEL: Record<string, string> = { IGPM: 'IGP-M', IPCA: 'IPCA', INPC: 'INPC', IGPDI: 'IGP-DI' };
const monthsBetween = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

/** Preenche o que o sistema já sabe: cliente, imóvel, contrato, corretor e imobiliária. O que faltar fica em branco para preencher. */
async function prefill(t: Template, orgId: string, user: { id: string; name: string }, person: any, side: 'a' | 'b', propertyId?: string | null, contractId?: string | null) {
  const out: Data = {};
  const twoSides = t.fields.some((f) => f.key === 'b_nome');
  Object.assign(out, personData(person, twoSides ? side : 'a'));
  const org = await q1<any>('SELECT name, public_name FROM organizations WHERE id=$1', [orgId]);
  const u = await q1<any>('SELECT card_profile FROM users WHERE id=$1', [user.id]);
  out.corretor_nome = user.name; out.corretor_creci = u?.card_profile?.creci ?? ''; out.imob_nome = org?.public_name || org?.name || '';
  out.data = todayStr();
  let prop: any = null;
  if (propertyId) {
    prop = await q1<any>('SELECT * FROM properties WHERE id=$1 AND org_id=$2', [propertyId, orgId]);
    if (!prop) throw Object.assign(new Error('Imóvel não encontrado.'), { statusCode: 404 });
    const a = prop.address ?? {};
    out.imovel_desc = `${prop.title} — ${addr(a)}${prop.area_total ? `, área total ${Number(prop.area_total).toLocaleString('pt-BR')} ${prop.area_unit === 'm2' ? 'm²' : prop.area_unit === 'ha' ? 'ha' : prop.area_unit}` : ''}`;
    out.cidade = prop.city ?? a.cidade ?? ''; out.foro = out.cidade;
    if (prop.price_sale != null) { out.preco = String(prop.price_sale); if (t.category === 'corretagem' && t.key === 'corretagem_venda') out.valor_pedido = String(prop.price_sale); }
    if (prop.price_rent != null) { out.valor_aluguel = String(prop.price_rent); if (t.key === 'corretagem_locacao') out.valor_pedido = String(prop.price_rent); }
    if (prop.price_lease != null) { out.renda = String(prop.price_lease); if (t.key === 'corretagem_arrendamento') out.valor_pedido = String(prop.price_lease); }
    if (prop.area_unit === 'ha' && prop.area_total) out.area_ha = String(prop.area_total);
    if (twoSides && side === 'b' && prop.owner_person_id && prop.owner_person_id !== person.id) { // cliente é locatário/comprador/arrendatário: o proprietário preenche o lado "a"
      const own = await q1<any>('SELECT * FROM people WHERE id=$1 AND org_id=$2', [prop.owner_person_id, orgId]);
      if (own) Object.assign(out, personData(own, 'a'));
    }
  }
  if (contractId) {
    const c = await q1<any>('SELECT * FROM contracts WHERE id=$1 AND org_id=$2', [contractId, orgId]);
    if (!c) throw Object.assign(new Error('Contrato não encontrado.'), { statusCode: 404 });
    const start = asStr(c.start_date), end = asStr(c.end_date), months = monthsBetween(start, end);
    out.inicio = start; out.meses = String(months); out.anos = String(Math.max(1, Math.round(months / 12)));
    out.valor_aluguel = String(c.value_amount); if (c.value_period === 'anual' || c.value_period === 'safra') out.renda = String(c.value_amount);
    if (c.due_day) out.dia_venc = String(c.due_day);
    const idx = normalizeIndex(c.adjustment_index); if (idx) out.indice = INDEX_LABEL[idx];
    if (c.deposit) out.garantia_valor = String(c.deposit);
  }
  return out;
}

const pub = (d: any) => ({ id: d.id, person_id: d.person_id, property_id: d.property_id, contract_id: d.contract_id, template_key: d.template_key, template_version: d.template_version, title: d.title, status: d.status, copied_from: d.copied_from, created_at: d.created_at, updated_at: d.updated_at });


/** Página de leitura/impressão do contrato (link público e prévia do painel). */
function renderDocHtml(title: string, body: string, status: string, from: string) {
  const aviso = status === 'rascunho' ? '<div class="av">RASCUNHO para conferência — sem validade até ser assinado.</div>' : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title>
<style>body{font:16px/1.6 Georgia,serif;margin:0;background:#f3f4f6;color:#111}.pg{max-width:780px;margin:16px auto;background:#fff;padding:32px 28px;box-shadow:0 1px 6px #0002}pre{white-space:pre-wrap;word-wrap:break-word;font:inherit;margin:0}.av{background:#fef3c7;border:1px solid #f59e0b;padding:8px 12px;margin-bottom:16px;font:14px system-ui,sans-serif}.bar{max-width:780px;margin:12px auto 0;padding:0 12px;font:14px system-ui,sans-serif;display:flex;justify-content:space-between;gap:8px;color:#555}button{font:inherit;padding:6px 12px;cursor:pointer}@media print{body{background:#fff}.bar{display:none}.pg{box-shadow:none;margin:0;padding:0}.av{display:none}}</style></head>
<body><div class="bar"><span>${esc(from)}</span><button id="pr" type="button">Imprimir / salvar PDF</button></div><div class="pg">${aviso}<pre>${esc(body)}</pre></div>
<script>document.getElementById('pr').addEventListener('click',function(){window.print()})</script></body></html>`;
}

export async function contractDocRoutes(app: FastifyInstance) {
  const perm = requirePerm('docs.contracts');
  const idOf = (req: any, k = 'id') => z.string().uuid().parse(req.params[k]);
  const loadDoc = (org: string, id: string) => q1<any>('SELECT * FROM contract_docs WHERE id=$1 AND org_id=$2', [id, org]);
  const notFound = (reply: any) => reply.code(404).send({ error: 'Documento não encontrado.' });

  // Catálogo de modelos (campos para o formulário) e fontes consultadas.
  app.get('/api/doc-templates', { preHandler: perm }, async () => ({
    fontes: SOURCES, consultado_em: SOURCE_CHECKED,
    aviso: 'Modelos simples, escritos na estrutura dos modelos dos Conselhos de Corretores de Imóveis. Não substituem a análise de um advogado nem o modelo oficial do seu CRECI.',
    categorias: CATEGORY_LABEL,
    modelos: TEMPLATES.map((t) => ({ key: t.key, title: t.title, category: t.category, version: t.version, summary: t.summary, sides: t.sides, warnings: t.warnings, fields: t.fields, two_sides: t.fields.some((f) => f.key === 'b_nome') })),
  }));

  app.get('/api/people/:id/contract-docs', { preHandler: perm }, async (req, reply) => {
    const pid = idOf(req);
    if (!(await q1('SELECT 1 FROM people WHERE id=$1 AND org_id=$2', [pid, req.user!.orgId]))) return reply.code(404).send({ error: 'Pessoa não encontrada.' });
    const rows = await q<any>(`SELECT d.*, p.code AS property_code, p.title AS property_title,
        (SELECT count(*)::int FROM contract_doc_shares s WHERE s.doc_id=d.id AND s.revoked_at IS NULL AND s.expires_at > now()) AS shares_ativos
      FROM contract_docs d LEFT JOIN properties p ON p.id=d.property_id WHERE d.org_id=$1 AND d.person_id=$2 ORDER BY d.updated_at DESC`, [req.user!.orgId, pid]);
    return rows.map((d) => ({ ...pub(d), property_code: d.property_code, property_title: d.property_title, shares_ativos: d.shares_ativos, template_title: templateByKey(d.template_key)?.title ?? d.template_key }));
  });

  app.post('/api/people/:id/contract-docs', { preHandler: perm }, async (req, reply) => {
    const pid = idOf(req); const org = req.user!.orgId;
    const b = z.object({ template_key: z.string(), side: z.enum(['a', 'b']).default('a'), property_id: z.string().uuid().nullish(), contract_id: z.string().uuid().nullish(), data: z.record(z.string(), z.string().max(4000)).default({}) }).parse(req.body);
    const t = templateByKey(b.template_key);
    if (!t) return reply.code(400).send({ error: 'Modelo inexistente.' });
    const person = await q1<any>('SELECT * FROM people WHERE id=$1 AND org_id=$2', [pid, org]);
    if (!person) return reply.code(404).send({ error: 'Pessoa não encontrada.' });
    let pre: Data;
    try { pre = await prefill(t, org, req.user!, person, b.side, b.property_id, b.contract_id); } catch (e: any) { if (e.statusCode) return reply.code(e.statusCode).send({ error: e.message }); throw e; }
    const data = { ...defaults(t), ...Object.fromEntries(Object.entries(pre).filter(([k, v]) => v && t.fields.some((f) => f.key === k))), ...defaults(t, b.data) };
    const body = t.build(data);
    const title = `${t.title} — ${person.display_name || person.name}`;
    const row = (await q<any>(`INSERT INTO contract_docs(org_id,person_id,property_id,contract_id,template_key,template_version,title,body,data,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *`,
      [org, pid, b.property_id ?? null, b.contract_id ?? null, t.key, t.version, title, body, JSON.stringify(data), req.user!.id]))[0];
    await audit(req, 'contractdoc.create', 'contract_doc', row.id, { template: t.key });
    return reply.code(201).send({ ...pub(row), body, data });
  });

  app.get('/api/contract-docs/:id', { preHandler: perm }, async (req, reply) => {
    const id = idOf(req); const d = await loadDoc(req.user!.orgId, id);
    if (!d) return notFound(reply);
    const versions = await q('SELECT id,title,status,saved_at,(SELECT name FROM users WHERE id=saved_by) AS saved_by_name FROM contract_doc_versions WHERE doc_id=$1 ORDER BY saved_at DESC LIMIT $2', [id, MAX_VERSIONS]);
    const shares = await q('SELECT id,expires_at,revoked_at,views,last_viewed_at,created_at FROM contract_doc_shares WHERE doc_id=$1 ORDER BY created_at DESC LIMIT 20', [id]);
    const t = templateByKey(d.template_key);
    await audit(req, 'contractdoc.view', 'contract_doc', id);
    return { ...pub(d), body: d.body, data: d.data, versions, shares, template: t ? { key: t.key, title: t.title, fields: t.fields, sides: t.sides, warnings: t.warnings, outdated: t.version > d.template_version } : null };
  });

  app.patch('/api/contract-docs/:id', { preHandler: perm }, async (req, reply) => {
    const id = idOf(req); const org = req.user!.orgId;
    const b = z.object({ title: z.string().trim().min(1).max(200).optional(), body: z.string().min(1).max(200000).optional(), status: z.enum(['rascunho', 'finalizado', 'assinado']).optional(), data: z.record(z.string(), z.string().max(4000)).optional(), regenerate: z.boolean().optional() }).parse(req.body);
    const out = await tx(async (c) => {
      const cur = (await c.query('SELECT * FROM contract_docs WHERE id=$1 AND org_id=$2 FOR UPDATE', [id, org])).rows[0];
      if (!cur) return { code: 404 as const, error: 'Documento não encontrado.' };
      const editing = b.title !== undefined || b.body !== undefined || b.data !== undefined || b.regenerate;
      if (editing && cur.status !== 'rascunho') return { code: 409 as const, error: 'Este documento está finalizado. Reabra como rascunho para editar.' };
      let body = b.body ?? cur.body; let data = cur.data;
      if (b.data) data = { ...cur.data, ...b.data };
      if (b.regenerate) {
        const t = templateByKey(cur.template_key); if (!t) return { code: 400 as const, error: 'O modelo deste documento não existe mais.' };
        body = t.build(data);
      }
      const title = b.title ?? cur.title, status = b.status ?? cur.status;
      if (body === cur.body && title === cur.title && status === cur.status && JSON.stringify(data) === JSON.stringify(cur.data)) return { code: 200 as const, row: cur };
      await c.query('INSERT INTO contract_doc_versions(org_id,doc_id,title,body,status,saved_by) VALUES ($1,$2,$3,$4,$5,$6)', [org, id, cur.title, cur.body, cur.status, req.user!.id]);
      await c.query('DELETE FROM contract_doc_versions WHERE doc_id=$1 AND id NOT IN (SELECT id FROM contract_doc_versions WHERE doc_id=$1 ORDER BY saved_at DESC LIMIT $2)', [id, MAX_VERSIONS]);
      const row = (await c.query('UPDATE contract_docs SET title=$3, body=$4, data=$5, status=$6, template_version=$7, updated_by=$8, updated_at=now() WHERE id=$1 AND org_id=$2 RETURNING *', [id, org, title, body, JSON.stringify(data), status, b.regenerate ? (templateByKey(cur.template_key)?.version ?? cur.template_version) : cur.template_version, req.user!.id])).rows[0];
      return { code: 200 as const, row };
    });
    if (out.code !== 200) return reply.code(out.code).send({ error: (out as any).error });
    await audit(req, 'contractdoc.update', 'contract_doc', id, { status: b.status, regenerate: !!b.regenerate });
    return { ...pub(out.row), body: out.row.body, data: out.row.data };
  });

  app.post('/api/contract-docs/:id/restore', { preHandler: perm }, async (req, reply) => {
    const id = idOf(req); const org = req.user!.orgId;
    const { version_id } = z.object({ version_id: z.string().uuid() }).parse(req.body);
    const out = await tx(async (c) => {
      const cur = (await c.query('SELECT * FROM contract_docs WHERE id=$1 AND org_id=$2 FOR UPDATE', [id, org])).rows[0];
      if (!cur) return { code: 404 as const, error: 'Documento não encontrado.' };
      if (cur.status !== 'rascunho') return { code: 409 as const, error: 'Reabra como rascunho para restaurar uma versão.' };
      const v = (await c.query('SELECT * FROM contract_doc_versions WHERE id=$1 AND doc_id=$2', [version_id, id])).rows[0];
      if (!v) return { code: 404 as const, error: 'Versão não encontrada.' };
      await c.query('INSERT INTO contract_doc_versions(org_id,doc_id,title,body,status,saved_by) VALUES ($1,$2,$3,$4,$5,$6)', [org, id, cur.title, cur.body, cur.status, req.user!.id]);
      const row = (await c.query(`UPDATE contract_docs SET title=$3, body=$4, updated_by=$5, updated_at=now() WHERE id=$1 AND org_id=$2 RETURNING *`, [id, org, v.title, v.body, req.user!.id])).rows[0];
      return { code: 200 as const, row };
    });
    if (out.code !== 200) return reply.code(out.code).send({ error: (out as any).error });
    await audit(req, 'contractdoc.restore', 'contract_doc', id);
    return { ...pub(out.row), body: out.row.body };
  });

  app.post('/api/contract-docs/:id/copy', { preHandler: perm }, async (req, reply) => {
    const id = idOf(req); const org = req.user!.orgId;
    const b = z.object({ person_id: z.string().uuid().optional() }).parse(req.body ?? {});
    const d = await loadDoc(org, id); if (!d) return notFound(reply);
    const target = b.person_id ?? d.person_id;
    if (!(await q1('SELECT 1 FROM people WHERE id=$1 AND org_id=$2', [target, org]))) return reply.code(404).send({ error: 'Pessoa não encontrada.' });
    const row = (await q<any>(`INSERT INTO contract_docs(org_id,person_id,property_id,contract_id,template_key,template_version,title,body,data,status,copied_from,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'rascunho',$10,$11,$11) RETURNING *`,
      [org, target, d.property_id, null, d.template_key, d.template_version, `Cópia de ${d.title}`.slice(0, 200), d.body, JSON.stringify(d.data), d.id, req.user!.id]))[0];
    await audit(req, 'contractdoc.copy', 'contract_doc', row.id, { from: id });
    return reply.code(201).send(pub(row));
  });

  app.delete('/api/contract-docs/:id', { preHandler: perm }, async (req, reply) => {
    const id = idOf(req); const d = await loadDoc(req.user!.orgId, id);
    if (!d) return notFound(reply);
    await q('DELETE FROM contract_docs WHERE id=$1 AND org_id=$2', [id, req.user!.orgId]); // versões e links caem em cascata
    await audit(req, 'contractdoc.delete', 'contract_doc', id, { template: d.template_key, status: d.status });
    return { ok: true };
  });

  // Prévia para imprimir ou salvar em PDF (abre em outra aba, exige login).
  app.get('/api/contract-docs/:id/print', { preHandler: perm }, async (req, reply) => {
    const id = idOf(req); const d = await loadDoc(req.user!.orgId, id);
    if (!d) return notFound(reply);
    const o = await q1<any>('SELECT name, public_name FROM organizations WHERE id=$1', [req.user!.orgId]);
    await audit(req, 'contractdoc.print', 'contract_doc', id);
    return reply.header('cache-control', 'no-store').header('x-robots-tag', 'noindex').type('text/html; charset=utf-8').send(renderDocHtml(d.title, d.body, d.status, o?.public_name || o?.name || ''));
  });

  // Compartilhar: link com validade (padrão 7 dias, máximo 30), revogável. O link completo só aparece na criação.
  app.post('/api/contract-docs/:id/shares', { preHandler: perm }, async (req, reply) => {
    const id = idOf(req); const org = req.user!.orgId;
    const b = z.object({ days: z.number().int().min(1).max(30).default(7) }).parse(req.body ?? {});
    if (!(await loadDoc(org, id))) return notFound(reply);
    const token = newToken();
    const row = (await q<any>(`INSERT INTO contract_doc_shares(org_id,doc_id,token_hash,expires_at,created_by) VALUES ($1,$2,$3, now() + ($4::int * interval '1 day'), $5) RETURNING id, expires_at`, [org, id, hashToken(token), b.days, req.user!.id]))[0];
    await audit(req, 'contractdoc.share', 'contract_doc', id, { days: b.days });
    return reply.code(201).send({ id: row.id, expires_at: row.expires_at, url: `${config.publicOrigin}/d/${token}` });
  });

  app.delete('/api/contract-docs/:id/shares/:sid', { preHandler: perm }, async (req, reply) => {
    const id = idOf(req), sid = idOf(req, 'sid');
    const r = await q('UPDATE contract_doc_shares SET revoked_at=now() WHERE id=$1 AND doc_id=$2 AND org_id=$3 AND revoked_at IS NULL RETURNING id', [sid, id, req.user!.orgId]);
    if (!r.length) return reply.code(404).send({ error: 'Link não encontrado.' });
    await audit(req, 'contractdoc.unshare', 'contract_doc', id);
    return { ok: true };
  });

  // Página pública do link (somente leitura, sem login, não indexável).
  app.get('/d/:token', rl(60, '1 minute'), async (req, reply) => {
    const token = String((req.params as any).token ?? '');
    const gone = () => reply.code(404).header('cache-control', 'no-store').header('x-robots-tag', 'noindex').type('text/html; charset=utf-8').send('<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Link indisponível</title><p style="font:16px system-ui;padding:2rem">Este link expirou ou foi cancelado. Peça um novo ao seu corretor.</p>');
    if (token.length < 20 || token.length > 100) return gone();
    const s = await q1<any>(`SELECT s.id, d.title, d.body, d.status, o.name AS org, o.public_name FROM contract_doc_shares s JOIN contract_docs d ON d.id=s.doc_id JOIN organizations o ON o.id=d.org_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at > now()`, [hashToken(token)]);
    if (!s) return gone();
    if (!/bot|crawl|spider|preview|facebookexternalhit|whatsapp|slack|telegram/i.test(String(req.headers['user-agent'] ?? ''))) await q('UPDATE contract_doc_shares SET views=views+1, last_viewed_at=now() WHERE id=$1', [s.id]);
    return reply.header('cache-control', 'no-store').header('x-robots-tag', 'noindex, nofollow').header('referrer-policy', 'no-referrer').type('text/html; charset=utf-8').send(renderDocHtml(s.title, s.body, s.status, s.public_name || s.org));
  });
}
