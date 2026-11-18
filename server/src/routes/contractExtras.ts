// Garantidores e vistorias de um contrato (locação/arrendamento).
import type { FastifyInstance } from '../http/mini.js';
import { z } from 'zod';
import { q, q1 } from '../db/pool.js';
import { audit, requirePerm } from '../lib/auth.js';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.');
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const asStr = (d: any) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : String(d ?? '').slice(0, 10));
const br = (d: any) => { const s = asStr(d); return s ? s.split('-').reverse().join('/') : ''; };

export const CONDITIONS = ['otimo', 'bom', 'regular', 'ruim', 'danificado', 'na'] as const;
const COND_LABEL: Record<string, string> = { otimo: 'Ótimo', bom: 'Bom', regular: 'Regular', ruim: 'Ruim', danificado: 'Danificado', na: 'Não se aplica' };
const RANK: Record<string, number> = { otimo: 0, bom: 1, regular: 2, ruim: 3, danificado: 4 };
const itemSchema = z.object({ room: z.string().trim().min(1).max(60), item: z.string().trim().min(1).max(80), condition: z.enum(CONDITIONS), notes: z.string().max(500).optional() });
type Item = z.infer<typeof itemSchema>;

const ROOMS_BASE = ['Sala', 'Cozinha', 'Quarto 1', 'Banheiro', 'Área de serviço', 'Área externa'];
const ITEMS_BASE = ['Paredes e pintura', 'Piso', 'Teto', 'Portas e janelas', 'Tomadas e interruptores', 'Torneiras e descargas'];
/** Roteiro padrão de vistoria de imóvel urbano; rural usa áreas próprias. */
export function checklist(kind: 'urbano' | 'rural' | 'vazio'): Item[] {
  if (kind === 'vazio') return [];
  if (kind === 'rural') return ['Sede / casa', 'Currais e cercas', 'Poços e reservatórios', 'Estradas e porteiras', 'Pastagem / área de plantio', 'Galpões e máquinas'].flatMap((room) => ['Estado geral', 'Observações'].map((item) => ({ room, item, condition: 'na' as const })));
  return ROOMS_BASE.flatMap((room) => ITEMS_BASE.filter((it) => !(it === 'Torneiras e descargas' && ['Sala', 'Área externa'].includes(room))).map((item) => ({ room, item, condition: 'na' as const })));
}

/** Itens que pioraram entre a vistoria de entrada e a de saída (mesmo cômodo + item). */
export function compareItems(entrada: Item[], saida: Item[]) {
  const e = new Map(entrada.map((i) => [`${i.room}|${i.item}`, i]));
  const out: { room: string; item: string; before: string; after: string; notes?: string }[] = [];
  for (const s of saida) {
    const b = e.get(`${s.room}|${s.item}`);
    if (b && b.condition in RANK && s.condition in RANK && RANK[s.condition] > RANK[b.condition]) out.push({ room: s.room, item: s.item, before: b.condition, after: s.condition, notes: s.notes });
  }
  return out;
}

export async function contractExtrasRoutes(app: FastifyInstance) {
  const read = requirePerm('contracts.read'), write = requirePerm('contracts.write');
  const contract = (org: string, id: string) => q1<any>('SELECT c.*, p.kind AS property_kind, p.title AS property_title FROM contracts c JOIN properties p ON p.id=c.property_id WHERE c.id=$1 AND c.org_id=$2', [id, org]);
  const nf = (reply: any, what: string) => reply.code(404).send({ error: `${what} não encontrado(a).` });

  // ---------- garantidores ----------
  const g = z.object({
    kind: z.enum(['fiador', 'avalista', 'caucao', 'seguro_fianca', 'titulo_capitalizacao', 'outra']),
    person_id: uuid.nullish(), description: z.string().trim().max(300).nullish(), policy_number: z.string().trim().max(80).nullish(),
    amount: z.number().min(0).max(1e9).nullish(), valid_until: date.nullish(), status: z.enum(['ativa', 'encerrada']).optional(), notes: z.string().max(1000).nullish(),
  });
  app.get('/api/contracts/:id/guarantors', { preHandler: read }, async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    if (!(await contract(req.user!.orgId, id))) return nf(reply, 'Contrato');
    return q(`SELECT g.*, COALESCE(p.display_name,p.name) AS person_name FROM contract_guarantors g LEFT JOIN people p ON p.id=g.person_id WHERE g.org_id=$1 AND g.contract_id=$2 ORDER BY g.status, g.created_at`, [req.user!.orgId, id]);
  });
  const checkPerson = async (org: string, pid?: string | null) => !pid || !!(await q1('SELECT 1 FROM people WHERE id=$1 AND org_id=$2', [pid, org]));
  app.post('/api/contracts/:id/guarantors', { preHandler: write }, async (req, reply) => {
    const id = uuid.parse((req.params as any).id); const b = g.parse(req.body); const org = req.user!.orgId;
    const c = await contract(org, id); if (!c) return nf(reply, 'Contrato');
    if (!(await checkPerson(org, b.person_id))) return reply.code(400).send({ error: 'Pessoa não encontrada.' });
    if (['fiador', 'avalista'].includes(b.kind) && !b.person_id && !b.description) return reply.code(400).send({ error: 'Informe quem é o fiador/avalista (pessoa cadastrada ou nome na descrição).' });
    if (b.kind === 'caucao' && b.amount == null) return reply.code(400).send({ error: 'Informe o valor da caução.' });
    if (['seguro_fianca', 'titulo_capitalizacao'].includes(b.kind) && !b.valid_until) return reply.code(400).send({ error: 'Informe o vencimento da apólice/título para receber o aviso.' });
    // Lei do Inquilinato (art. 37): uma só modalidade de garantia por locação.
    if (c.kind === 'locacao') {
      const other = await q1<any>(`SELECT 1 FROM contract_guarantors WHERE contract_id=$1 AND status='ativa' AND kind NOT IN ('fiador','avalista') AND $2 NOT IN ('fiador','avalista') LIMIT 1`, [id, b.kind]);
      const mix = await q1<any>(`SELECT 1 FROM contract_guarantors WHERE contract_id=$1 AND status='ativa' AND (($2 IN ('fiador','avalista')) <> (kind IN ('fiador','avalista'))) LIMIT 1`, [id, b.kind]);
      if (other || mix) return reply.code(409).send({ error: 'A lei permite uma só modalidade de garantia na locação (fiança, caução, seguro-fiança ou título). Encerre a atual antes de cadastrar outra.' });
    }
    const row = (await q<any>(`INSERT INTO contract_guarantors(org_id,contract_id,kind,person_id,description,policy_number,amount,valid_until,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [org, id, b.kind, b.person_id ?? null, b.description ?? null, b.policy_number ?? null, b.amount ?? null, b.valid_until ?? null, b.notes ?? null, req.user!.id]))[0];
    await audit(req, 'guarantor.create', 'contract', id, { kind: b.kind });
    return reply.code(201).send(row);
  });
  app.patch('/api/guarantors/:id', { preHandler: write }, async (req, reply) => {
    const id = uuid.parse((req.params as any).id); const b = g.partial().parse(req.body); const org = req.user!.orgId;
    const cur = await q1<any>('SELECT * FROM contract_guarantors WHERE id=$1 AND org_id=$2', [id, org]); if (!cur) return nf(reply, 'Garantia');
    if (b.person_id !== undefined && !(await checkPerson(org, b.person_id))) return reply.code(400).send({ error: 'Pessoa não encontrada.' });
    const m = { ...cur, ...b };
    const row = (await q<any>(`UPDATE contract_guarantors SET kind=$3, person_id=$4, description=$5, policy_number=$6, amount=$7, valid_until=$8, status=$9, notes=$10 WHERE id=$1 AND org_id=$2 RETURNING *`,
      [id, org, m.kind, m.person_id, m.description, m.policy_number, m.amount, m.valid_until, m.status, m.notes]))[0];
    await audit(req, 'guarantor.update', 'contract', cur.contract_id, { status: b.status });
    return row;
  });
  app.delete('/api/guarantors/:id', { preHandler: write }, async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const r = await q('DELETE FROM contract_guarantors WHERE id=$1 AND org_id=$2 RETURNING contract_id', [id, req.user!.orgId]);
    if (!r.length) return nf(reply, 'Garantia');
    await audit(req, 'guarantor.delete', 'contract', (r[0] as any).contract_id);
    return { ok: true };
  });

  // ---------- vistorias ----------
  app.get('/api/contracts/:id/inspections', { preHandler: read }, async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    if (!(await contract(req.user!.orgId, id))) return nf(reply, 'Contrato');
    const rows = await q<any>(`SELECT id,kind,inspected_on,status,general_notes,meters,keys_count,items,updated_at FROM inspections WHERE org_id=$1 AND contract_id=$2 ORDER BY inspected_on, created_at`, [req.user!.orgId, id]);
    return rows.map((r) => ({ ...r, resumo: { itens: r.items.length, avaliados: r.items.filter((i: Item) => i.condition !== 'na').length, problemas: r.items.filter((i: Item) => ['ruim', 'danificado'].includes(i.condition)).length } }));
  });
  app.post('/api/contracts/:id/inspections', { preHandler: write }, async (req, reply) => {
    const id = uuid.parse((req.params as any).id); const org = req.user!.orgId;
    const b = z.object({ kind: z.enum(['entrada', 'saida', 'periodica']), inspected_on: date, template: z.enum(['padrao', 'vazio', 'copiar_entrada']).default('padrao') }).parse(req.body);
    const c = await contract(org, id); if (!c) return nf(reply, 'Contrato');
    let items: Item[];
    if (b.template === 'copiar_entrada') { // saída parte do roteiro da entrada, com tudo a reavaliar
      const e = await q1<any>(`SELECT items FROM inspections WHERE contract_id=$1 AND org_id=$2 AND kind='entrada' ORDER BY inspected_on DESC LIMIT 1`, [id, org]);
      if (!e) return reply.code(400).send({ error: 'Este contrato ainda não tem vistoria de entrada para copiar.' });
      items = e.items.map((i: Item) => ({ room: i.room, item: i.item, condition: 'na' as const }));
    } else items = checklist(b.template === 'vazio' ? 'vazio' : c.property_kind === 'rural' ? 'rural' : 'urbano');
    const row = (await q<any>(`INSERT INTO inspections(org_id,contract_id,kind,inspected_on,items,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [org, id, b.kind, b.inspected_on, JSON.stringify(items), req.user!.id]))[0];
    await audit(req, 'inspection.create', 'contract', id, { kind: b.kind });
    return reply.code(201).send(row);
  });
  app.get('/api/inspections/:id', { preHandler: read }, async (req, reply) => {
    const r = await q1<any>('SELECT * FROM inspections WHERE id=$1 AND org_id=$2', [uuid.parse((req.params as any).id), req.user!.orgId]);
    return r ?? nf(reply, 'Vistoria');
  });
  app.patch('/api/inspections/:id', { preHandler: write }, async (req, reply) => {
    const id = uuid.parse((req.params as any).id); const org = req.user!.orgId;
    const b = z.object({ inspected_on: date.optional(), items: z.array(itemSchema).max(300).optional(), general_notes: z.string().max(4000).nullish(), meters: z.string().max(500).nullish(), keys_count: z.string().max(200).nullish(), status: z.enum(['rascunho', 'concluida']).optional() }).parse(req.body);
    const cur = await q1<any>('SELECT * FROM inspections WHERE id=$1 AND org_id=$2', [id, org]); if (!cur) return nf(reply, 'Vistoria');
    if (cur.status === 'concluida' && (b.items || b.general_notes !== undefined || b.meters !== undefined || b.keys_count !== undefined || b.inspected_on) && b.status !== 'rascunho')
      return reply.code(409).send({ error: 'Vistoria concluída. Reabra como rascunho para editar.' });
    const m = { ...cur, ...b, items: b.items ?? cur.items, status: b.status ?? cur.status };
    const row = (await q<any>(`UPDATE inspections SET inspected_on=$3, items=$4, general_notes=$5, meters=$6, keys_count=$7, status=$8, updated_at=now() WHERE id=$1 AND org_id=$2 RETURNING *`,
      [id, org, asStr(m.inspected_on), JSON.stringify(m.items), m.general_notes ?? null, m.meters ?? null, m.keys_count ?? null, m.status]))[0];
    await audit(req, 'inspection.update', 'contract', cur.contract_id, { status: b.status });
    return row;
  });
  app.delete('/api/inspections/:id', { preHandler: write }, async (req, reply) => {
    const r = await q('DELETE FROM inspections WHERE id=$1 AND org_id=$2 RETURNING contract_id', [uuid.parse((req.params as any).id), req.user!.orgId]);
    if (!r.length) return nf(reply, 'Vistoria');
    await audit(req, 'inspection.delete', 'contract', (r[0] as any).contract_id);
    return { ok: true };
  });
  // Entrada x saída: o que piorou.
  app.get('/api/contracts/:id/inspections/compare', { preHandler: read }, async (req, reply) => {
    const id = uuid.parse((req.params as any).id); const org = req.user!.orgId;
    if (!(await contract(org, id))) return nf(reply, 'Contrato');
    const e = await q1<any>(`SELECT * FROM inspections WHERE contract_id=$1 AND org_id=$2 AND kind='entrada' ORDER BY inspected_on DESC LIMIT 1`, [id, org]);
    const s = await q1<any>(`SELECT * FROM inspections WHERE contract_id=$1 AND org_id=$2 AND kind='saida' ORDER BY inspected_on DESC LIMIT 1`, [id, org]);
    if (!e || !s) return reply.code(400).send({ error: 'Precisa de uma vistoria de entrada e uma de saída.' });
    return { entrada: { id: e.id, data: asStr(e.inspected_on) }, saida: { id: s.id, data: asStr(s.inspected_on) }, pioraram: compareItems(e.items, s.items).map((x) => ({ ...x, before_label: COND_LABEL[x.before], after_label: COND_LABEL[x.after] })) };
  });
  // Laudo para imprimir ou salvar em PDF, com campos de assinatura.
  app.get('/api/inspections/:id/print', { preHandler: read }, async (req, reply) => {
    const v = await q1<any>(`SELECT i.*, p.title AS property_title, COALESCE(o.display_name,o.name) AS owner_name, COALESCE(t.display_name,t.name) AS tenant_name FROM inspections i JOIN contracts c ON c.id=i.contract_id JOIN properties p ON p.id=c.property_id JOIN people o ON o.id=c.owner_person_id JOIN people t ON t.id=c.counterparty_person_id WHERE i.id=$1 AND i.org_id=$2`, [uuid.parse((req.params as any).id), req.user!.orgId]);
    if (!v) return nf(reply, 'Vistoria');
    const rooms = [...new Set<string>(v.items.map((i: Item) => i.room))];
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Laudo de vistoria — ${esc(v.property_title)}</title>
<style>body{font:14px/1.45 system-ui,sans-serif;margin:24px;color:#111}h1{font-size:1.2rem}h2{font-size:1rem;margin:1rem 0 .3rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:4px 6px;text-align:left}.ass{display:flex;gap:2rem;margin-top:3rem}.ass div{flex:1;border-top:1px solid #000;padding-top:4px;text-align:center}button{padding:6px 12px}@media print{button{display:none}}</style></head><body>
<button id="pr" type="button">Imprimir / salvar PDF</button>
<h1>Laudo de vistoria de ${esc(v.kind)} — ${esc(v.property_title)}</h1><p>Data: ${br(v.inspected_on)} · Proprietário: ${esc(v.owner_name)} · Locatário/arrendatário: ${esc(v.tenant_name)}${v.status === 'rascunho' ? ' · <b>RASCUNHO</b>' : ''}</p>
${v.meters ? `<p><b>Medidores:</b> ${esc(v.meters)}</p>` : ''}${v.keys_count ? `<p><b>Chaves/controles:</b> ${esc(v.keys_count)}</p>` : ''}
${rooms.map((r) => `<h2>${esc(r)}</h2><table><tr><th>Item</th><th style="width:110px">Estado</th><th>Observações</th></tr>${v.items.filter((i: Item) => i.room === r).map((i: Item) => `<tr><td>${esc(i.item)}</td><td>${esc(COND_LABEL[i.condition])}</td><td>${esc(i.notes ?? '')}</td></tr>`).join('')}</table>`).join('')}
${v.general_notes ? `<h2>Observações gerais</h2><p style="white-space:pre-wrap">${esc(v.general_notes)}</p>` : ''}
<div class="ass"><div>Proprietário / imobiliária</div><div>${esc(v.tenant_name)}</div></div>
<script>document.getElementById('pr').addEventListener('click',function(){window.print()})</script></body></html>`;
    return reply.header('cache-control', 'no-store').header('x-robots-tag', 'noindex').type('text/html; charset=utf-8').send(html);
  });
}
