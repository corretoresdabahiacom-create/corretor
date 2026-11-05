import { useState } from 'react';
import { ApiError, get, patch, post } from '../api';
import { useSession } from '../session';
import { Async, Empty, Field, Modal, StatusChip, useAsync, useConfirm, useToast } from '../ui';
import { brl, dateBR, L } from '../format';
import { FilesPanel } from './Files';

export function ContractAlerts() {
  const st = useAsync(() => get('/api/contracts/alerts'), []);
  return <Async state={st}>{(a: any[]) => !a.length ? null : (
    <section className="card stack"><h2>Contratos: prazos</h2>
      {a.slice(0, 6).map((x, i) => <div key={i} className={`alert ${x.severity === 'alta' ? 'err' : x.severity === 'media' ? 'warn' : ''} small`}><b>{x.property_title}</b> · {x.counterparty_name}<br />{x.message}</div>)}
    </section>
  )}</Async>;
}

function ContractForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const props = useAsync(() => get('/api/properties?pageSize=100'), []);
  const people = useAsync(() => get('/api/people?pageSize=100&sort=name'), []);
  const [f, setF] = useState<any>({ kind: 'locacao', value_period: 'mensal', property_id: '', owner_person_id: '', counterparty_person_id: '', start_date: '', end_date: '', value_amount: '', due_day: '', deposit: '', adjustment_index: '', adjustment_month: '', guarantee: '', rural_area_ha: '', notes: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));
  const num = (v: string) => (v === '' ? null : Number(v.replace(',', '.')));
  const save = async () => {
    setBusy(true); setErr('');
    try {
      await post('/api/contracts', { ...f, value_amount: num(String(f.value_amount)) ?? 0, due_day: num(String(f.due_day)), deposit: num(String(f.deposit)), adjustment_month: num(String(f.adjustment_month)), rural_area_ha: f.kind === 'arrendamento' ? num(String(f.rural_area_ha)) : null, adjustment_index: f.adjustment_index || null, guarantee: f.guarantee || null, notes: f.notes || null });
      toast('Contrato registrado como rascunho'); onSaved();
    } catch (e) { setErr(e instanceof ApiError ? (e.body.fields?.[0]?.message ?? e.message) : 'Erro'); } finally { setBusy(false); }
  };
  const P = (props.data?.items ?? []).filter((p: any) => f.kind === 'arrendamento' ? p.kind === 'rural' : true);
  const pe = people.data?.items ?? [];
  return (
    <Modal title="Novo contrato" onClose={onClose}>
      <div className="stack">
        <Field label="Tipo"><select value={f.kind} onChange={(e) => set('kind', e.target.value)}><option value="locacao">Locação</option><option value="arrendamento">Arrendamento rural</option></select></Field>
        <Field label="Imóvel"><select value={f.property_id} onChange={(e) => set('property_id', e.target.value)}><option value="">Selecione…</option>{P.map((p: any) => <option key={p.id} value={p.id}>{p.code} · {p.title}</option>)}</select></Field>
        <Field label="Proprietário / arrendador"><select value={f.owner_person_id} onChange={(e) => set('owner_person_id', e.target.value)}><option value="">Selecione…</option>{pe.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label={f.kind === 'locacao' ? 'Locatário' : 'Arrendatário'}><select value={f.counterparty_person_id} onChange={(e) => set('counterparty_person_id', e.target.value)}><option value="">Selecione…</option>{pe.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <div className="grid g2"><Field label="Início"><input type="date" value={f.start_date} onChange={(e) => set('start_date', e.target.value)} /></Field><Field label="Fim"><input type="date" value={f.end_date} onChange={(e) => set('end_date', e.target.value)} /></Field></div>
        <div className="grid g2"><Field label="Valor (R$)"><input inputMode="decimal" value={f.value_amount} onChange={(e) => set('value_amount', e.target.value)} /></Field><Field label="Periodicidade"><select value={f.value_period} onChange={(e) => set('value_period', e.target.value)}><option value="mensal">Mensal</option><option value="anual">Anual</option>{f.kind === 'arrendamento' && <option value="safra">Por safra</option>}</select></Field></div>
        <div className="grid g2"><Field label="Dia do vencimento"><input inputMode="numeric" value={f.due_day} onChange={(e) => set('due_day', e.target.value)} /></Field><Field label="Caução / depósito (R$)"><input inputMode="decimal" value={f.deposit} onChange={(e) => set('deposit', e.target.value)} /></Field></div>
        <div className="grid g2"><Field label="Índice de reajuste"><input placeholder="IGP-M, IPCA…" value={f.adjustment_index} onChange={(e) => set('adjustment_index', e.target.value)} /></Field><Field label="Mês do reajuste (1–12)"><input inputMode="numeric" value={f.adjustment_month} onChange={(e) => set('adjustment_month', e.target.value)} /></Field></div>
        {f.kind === 'arrendamento' && <Field label="Área arrendada (ha)"><input inputMode="decimal" value={f.rural_area_ha} onChange={(e) => set('rural_area_ha', e.target.value)} /></Field>}
        <Field label="Garantia"><input value={f.guarantee} onChange={(e) => set('guarantee', e.target.value)} /></Field>
        <Field label="Observações"><textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        <p className="small muted">Este cadastro serve para controle de prazos e valores. Ele não gera nem substitui o contrato jurídico; anexe o contrato assinado depois.</p>
        {err && <div className="alert err" role="alert">{err}</div>}
        <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Salvando…' : 'Salvar rascunho'}</button>
      </div>
    </Modal>
  );
}

function ContractModal({ c, onClose, onChanged }: { c: any; onClose: () => void; onChanged: () => void }) {
  const { can } = useSession(); const toast = useToast(); const { ask, node } = useConfirm();
  const [err, setErr] = useState(''); const [closing, setClosing] = useState(false); const [reason, setReason] = useState(''); const [kind, setKind] = useState('encerrado');
  const run = async (fn: () => Promise<any>, ok: string) => { setErr(''); try { await fn(); toast(ok); onChanged(); onClose(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Erro'); } };
  const w = can('contracts.write');
  return (
    <Modal title={`${L(c.kind)} · ${c.property_title}`} onClose={onClose}>
      <div className="stack">
        <div className="chips"><StatusChip s={c.status} /><span className="chip">{c.property_code}</span></div>
        <div>👤 {c.owner_name} → {c.counterparty_name}</div>
        <div>📅 {dateBR(c.start_date)} a {dateBR(c.end_date)}</div>
        <div>💰 <b>{brl(c.value_amount)}</b> ({c.value_period}){c.due_day ? ` · vence dia ${c.due_day}` : ''}{c.deposit ? ` · caução ${brl(c.deposit)}` : ''}</div>
        {c.adjustment_month && <div>📈 Reajuste em {c.adjustment_month}/mês{c.adjustment_index ? ` (${c.adjustment_index})` : ''}</div>}
        {c.rural_area_ha && <div>🌾 {c.rural_area_ha} ha arrendados</div>}
        {c.guarantee && <div>Garantia: {c.guarantee}</div>}
        {c.notes && <div className="muted">{c.notes}</div>}
        {c.closed_reason && <div className="alert warn">Motivo do encerramento: {c.closed_reason}</div>}
        {err && <div className="alert err" role="alert">{err}</div>}
        {w && c.status === 'rascunho' && <button className="btn primary" onClick={async () => { if (await ask('Ativar o contrato? O imóvel passará para alugado/arrendado.', 'Ativar')) run(() => post(`/api/contracts/${c.id}/activate`), 'Contrato ativado'); }}>Ativar contrato</button>}
        {w && c.status === 'ativo' && !closing && <button className="btn danger" onClick={() => setClosing(true)}>Encerrar / rescindir…</button>}
        {closing && <><Field label="Situação"><select value={kind} onChange={(e) => setKind(e.target.value)}><option value="encerrado">Encerrado (fim do prazo)</option><option value="rescindido">Rescindido</option></select></Field><Field label="Motivo"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field><button className="btn danger" disabled={reason.trim().length < 3} onClick={() => run(() => post(`/api/contracts/${c.id}/close`, { status: kind, reason }), 'Contrato encerrado')}>Confirmar</button></>}
        <FilesPanel base={`/api/contracts/${c.id}`} canWrite={w} />
      </div>
      {node}
    </Modal>
  );
}

export default function Contracts() {
  const { can } = useSession();
  const [status, setStatus] = useState('ativo'); const [creating, setCreating] = useState(false); const [sel, setSel] = useState<any>(null);
  const st = useAsync(() => get(`/api/contracts${status ? `?status=${status}` : ''}`), [status]);
  return (
    <>
      <div className="row"><h1>Contratos</h1>{can('contracts.write') && <button className="btn primary right" onClick={() => setCreating(true)}>+ Contrato</button>}</div>
      <ContractAlerts />
      <div className="row" style={{ marginBottom: '.6rem' }}>{[['ativo', 'Ativos'], ['rascunho', 'Rascunhos'], ['encerrado', 'Encerrados'], ['', 'Todos']].map(([k, l]) => <button key={k} className={`btn small ${status === k ? 'primary' : ''}`} onClick={() => setStatus(k)}>{l}</button>)}</div>
      <Async state={st}>{(rows: any[]) => !rows.length ? <Empty>Nenhum contrato aqui. Registre locações e arrendamentos para receber alertas de vencimento e reajuste.</Empty> : <div className="list">{rows.map((c) => <button key={c.id} className="item" style={{ textAlign: 'left' }} onClick={() => setSel(c)}><div style={{ flex: 1 }}><b>{c.property_title}</b><div className="small muted">{L(c.kind)} · {c.counterparty_name} · até {dateBR(c.end_date)}</div></div><div>{brl(c.value_amount)}</div></button>)}</div>}</Async>
      {creating && <ContractForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); st.reload(); }} />}
      {sel && <ContractModal c={sel} onClose={() => setSel(null)} onChanged={st.reload} />}
    </>
  );
}
