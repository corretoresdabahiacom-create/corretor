import { useState } from 'react';
import { ApiError, del, get, patch, post } from '../api';
import { Async, Empty, Field, Modal, useAsync, useConfirm, useToast } from '../ui';
import { brl, dateBR } from '../format';

const KINDS: [string, string][] = [['fiador', 'Fiador'], ['avalista', 'Avalista'], ['caucao', 'Caução (depósito)'], ['seguro_fianca', 'Seguro-fiança'], ['titulo_capitalizacao', 'Título de capitalização'], ['outra', 'Outra']];
const kindLabel = (k: string) => KINDS.find(([v]) => v === k)?.[1] ?? k;
const today = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Erro inesperado');

export function GuarantorsPanel({ contractId, canWrite }: { contractId: string; canWrite: boolean }) {
  const st = useAsync(() => get(`/api/contracts/${contractId}/guarantors`), [contractId]);
  const people = useAsync(() => get('/api/people?pageSize=100&sort=name'), []);
  const toast = useToast(); const { ask, node } = useConfirm();
  const [adding, setAdding] = useState(false); const [err, setErr] = useState('');
  const [f, setF] = useState<any>({ kind: 'fiador' });
  const set = (k: string, v: any) => setF((o: any) => ({ ...o, [k]: v }));
  const save = async () => {
    setErr('');
    try {
      await post(`/api/contracts/${contractId}/guarantors`, { kind: f.kind, person_id: f.person_id || null, description: f.description || null, policy_number: f.policy_number || null, amount: f.amount ? Number(String(f.amount).replace(',', '.')) : null, valid_until: f.valid_until || null, notes: f.notes || null });
      toast('Garantia cadastrada'); setAdding(false); setF({ kind: 'fiador' }); st.reload();
    } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <section className="card stack"><div className="row"><h2>Garantias</h2>{canWrite && <button className="btn small right" onClick={() => setAdding(true)}>+ Garantia</button>}</div>
      <Async state={st}>{(rows: any[]) => !rows.length ? <Empty>Nenhuma garantia cadastrada.</Empty> : <div className="list">{rows.map((g) => (
        <div className="item" key={g.id} style={{ opacity: g.status === 'encerrada' ? .55 : 1 }}>
          <div style={{ flex: 1 }}><b>{kindLabel(g.kind)}</b>{g.person_name ? ` · ${g.person_name}` : g.description ? ` · ${g.description}` : ''}
            <div className="small muted">{g.amount != null ? `${brl(g.amount)} · ` : ''}{g.policy_number ? `apólice ${g.policy_number} · ` : ''}{g.valid_until ? `válida até ${dateBR(g.valid_until)} · ` : ''}{g.status}</div></div>
          {canWrite && <div className="row">
            {g.status === 'ativa' && <button className="btn small" onClick={async () => { try { await patch(`/api/guarantors/${g.id}`, { status: 'encerrada' }); st.reload(); } catch (e) { toast(errMsg(e)); } }}>Encerrar</button>}
            <button className="btn small danger" onClick={async () => { if (await ask('Excluir esta garantia?', 'Excluir')) { try { await del(`/api/guarantors/${g.id}`); st.reload(); } catch (e) { toast(errMsg(e)); } } }}>Excluir</button></div>}
        </div>))}</div>}</Async>
      <p className="small muted">Na locação a lei permite uma só modalidade de garantia (fiança, caução, seguro-fiança ou título). Seguro e título avisam antes de vencer.</p>
      {adding && <Modal title="Nova garantia" onClose={() => setAdding(false)}><div className="stack">
        <Field label="Modalidade"><select value={f.kind} onChange={(e) => set('kind', e.target.value)}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        {['fiador', 'avalista'].includes(f.kind) && <Field label="Pessoa cadastrada"><select value={f.person_id ?? ''} onChange={(e) => set('person_id', e.target.value)}><option value="">— outra / informar nome abaixo —</option>{(people.data?.items ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
        <Field label="Descrição / nome"><input value={f.description ?? ''} onChange={(e) => set('description', e.target.value)} /></Field>
        {['seguro_fianca', 'titulo_capitalizacao', 'outra'].includes(f.kind) && <Field label="Nº da apólice / título"><input value={f.policy_number ?? ''} onChange={(e) => set('policy_number', e.target.value)} /></Field>}
        {['caucao', 'seguro_fianca', 'titulo_capitalizacao', 'outra'].includes(f.kind) && <Field label="Valor (R$)"><input inputMode="decimal" value={f.amount ?? ''} onChange={(e) => set('amount', e.target.value)} /></Field>}
        <Field label="Válida até"><input type="date" value={f.valid_until ?? ''} onChange={(e) => set('valid_until', e.target.value)} /></Field>
        <Field label="Observações"><textarea value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
        {err && <div className="alert err" role="alert">{err}</div>}
        <button className="btn primary" onClick={save}>Salvar</button></div></Modal>}
      {node}
    </section>
  );
}

const CONDS: [string, string][] = [['na', '—'], ['otimo', 'Ótimo'], ['bom', 'Bom'], ['regular', 'Regular'], ['ruim', 'Ruim'], ['danificado', 'Danificado']];
const KIND_L: Record<string, string> = { entrada: 'Entrada', saida: 'Saída', periodica: 'Periódica' };

function InspectionEditor({ id, canWrite, onClose }: { id: string; canWrite: boolean; onClose: () => void }) {
  const st = useAsync(() => get(`/api/inspections/${id}`), [id]);
  const toast = useToast(); const [v, setV] = useState<any>(null); const [err, setErr] = useState('');
  const cur = v ?? st.data; const locked = !canWrite || cur?.status === 'concluida';
  const upd = (patchObj: any) => setV({ ...cur, ...patchObj });
  const setItem = (i: number, p: any) => upd({ items: cur.items.map((it: any, k: number) => (k === i ? { ...it, ...p } : it)) });
  const save = async (status?: string) => {
    setErr('');
    try { await patch(`/api/inspections/${id}`, { items: cur.items, general_notes: cur.general_notes ?? null, meters: cur.meters ?? null, keys_count: cur.keys_count ?? null, ...(status ? { status } : {}) }); toast(status === 'concluida' ? 'Vistoria concluída' : 'Vistoria salva'); setV(null); st.reload(); }
    catch (e) { setErr(errMsg(e)); }
  };
  return (
    <Modal title="Vistoria" onClose={onClose} wide>
      <Async state={st}>{() => cur && (
        <div className="stack">
          <div className="small muted">{KIND_L[cur.kind]} · {dateBR(cur.inspected_on)} · {cur.status}</div>
          {[...new Set<string>(cur.items.map((i: any) => i.room))].map((room) => (
            <div key={room}><h3>{room}</h3>
              {cur.items.map((it: any, i: number) => it.room !== room ? null : (
                <div className="row" key={i} style={{ gap: '.4rem', marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{ minWidth: 150 }}>{it.item}</span>
                  <select disabled={locked} value={it.condition} aria-label={`Estado: ${it.item}`} onChange={(e) => setItem(i, { condition: e.target.value })}>{CONDS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select>
                  <input disabled={locked} placeholder="Observação" value={it.notes ?? ''} maxLength={500} onChange={(e) => setItem(i, { notes: e.target.value })} style={{ flex: 1, minWidth: 140 }} />
                </div>))}
            </div>))}
          <Field label="Medidores (luz, água, gás)"><input disabled={locked} value={cur.meters ?? ''} onChange={(e) => upd({ meters: e.target.value })} /></Field>
          <Field label="Chaves e controles entregues"><input disabled={locked} value={cur.keys_count ?? ''} onChange={(e) => upd({ keys_count: e.target.value })} /></Field>
          <Field label="Observações gerais"><textarea disabled={locked} value={cur.general_notes ?? ''} onChange={(e) => upd({ general_notes: e.target.value })} /></Field>
          <p className="small muted">Fotos da vistoria: anexe nos arquivos do contrato (categoria “foto”).</p>
          {err && <div className="alert err" role="alert">{err}</div>}
          <div className="row">
            <a className="btn" href={`/api/inspections/${id}/print`} target="_blank" rel="noreferrer">Laudo para imprimir</a>
            {canWrite && cur.status === 'rascunho' && <><button className="btn right" onClick={() => save()}>Salvar rascunho</button><button className="btn primary" onClick={() => save('concluida')}>Concluir</button></>}
            {canWrite && cur.status === 'concluida' && <button className="btn right" onClick={() => save('rascunho')}>Reabrir para editar</button>}
          </div>
        </div>)}</Async>
    </Modal>
  );
}

export function InspectionsPanel({ contractId, canWrite }: { contractId: string; canWrite: boolean }) {
  const st = useAsync(() => get(`/api/contracts/${contractId}/inspections`), [contractId]);
  const toast = useToast(); const { ask, node } = useConfirm();
  const [open, setOpen] = useState<string | null>(null); const [cmp, setCmp] = useState<any>(null);
  const create = async (kind: string, template: string) => {
    try { const r = await post(`/api/contracts/${contractId}/inspections`, { kind, inspected_on: today(), template }); st.reload(); setOpen(r.id); } catch (e) { toast(errMsg(e)); }
  };
  return (
    <section className="card stack"><h2>Vistorias</h2>
      {canWrite && <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn small" onClick={() => create('entrada', 'padrao')}>+ Entrada</button>
        <button className="btn small" onClick={() => create('saida', 'copiar_entrada')}>+ Saída (parte da entrada)</button>
        <button className="btn small" onClick={() => create('periodica', 'padrao')}>+ Periódica</button>
        <button className="btn small right" onClick={async () => { try { setCmp(await get(`/api/contracts/${contractId}/inspections/compare`)); } catch (e) { toast(errMsg(e)); } }}>Comparar entrada × saída</button></div>}
      <Async state={st}>{(rows: any[]) => !rows.length ? <Empty>Nenhuma vistoria registrada.</Empty> : <div className="list">{rows.map((r) => (
        <div className="item" key={r.id}><button className="btn small" style={{ flex: 1, textAlign: 'left' }} onClick={() => setOpen(r.id)}><b>{KIND_L[r.kind]}</b> · {dateBR(r.inspected_on)} · {r.status}<div className="small muted">{r.resumo.avaliados}/{r.resumo.itens} itens avaliados{r.resumo.problemas ? ` · ${r.resumo.problemas} com problema` : ''}</div></button>
          {canWrite && <button className="btn small danger" onClick={async () => { if (await ask('Excluir esta vistoria?', 'Excluir')) { try { await del(`/api/inspections/${r.id}`); st.reload(); } catch (e) { toast(errMsg(e)); } } }}>Excluir</button>}</div>))}</div>}</Async>
      {open && <InspectionEditor id={open} canWrite={canWrite} onClose={() => { setOpen(null); st.reload(); }} />}
      {cmp && <Modal title="Entrada × saída" onClose={() => setCmp(null)}><div className="stack">
        <div className="small muted">Entrada {dateBR(cmp.entrada.data)} · Saída {dateBR(cmp.saida.data)}</div>
        {!cmp.pioraram.length ? <div className="alert ok">Nenhum item piorou em relação à entrada.</div> : <div className="list">{cmp.pioraram.map((x: any, i: number) => <div className="item" key={i}><div><b>{x.room} — {x.item}</b><div className="small">{x.before_label} → {x.after_label}{x.notes ? ` · ${x.notes}` : ''}</div></div></div>)}</div>}
        <p className="small muted">Desgaste natural do uso normal não costuma ser cobrado do locatário; avalie caso a caso.</p></div></Modal>}
      {node}
    </section>
  );
}
