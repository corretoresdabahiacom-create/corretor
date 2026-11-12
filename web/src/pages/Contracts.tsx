import { useState } from 'react';
import { ApiError, api, get, patch, post } from '../api';
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

function PaymentSummary() {
  const st = useAsync(() => get('/api/contract-payments/summary'), []);
  return <Async state={st}>{(s: any) => (Number(s.esperado) || Number(s.em_atraso)) ? (
    <section className="card stack"><h2>Recebimentos do mês</h2>
      <div className="chips"><span className="chip">Esperado {brl(Number(s.esperado))}</span><span className="chip ok">Recebido {brl(Number(s.recebido))}</span>{Number(s.em_atraso) > 0 && <span className="chip bad">Em atraso {brl(Number(s.em_atraso))} ({s.parcelas_atrasadas} parcela(s))</span>}</div>
      {s.atrasadas?.slice(0, 5).map((p: any) => <div key={p.id} className="small"><b>{p.property_title}</b> · {p.counterparty_name} · venceu {dateBR(p.due_date)} ({p.dias} dia(s)) · {brl(Number(p.amount) - Number(p.paid_amount ?? 0))}</div>)}
    </section>) : null}</Async>;
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


const METHODS: Record<string, string> = { pix: 'Pix', boleto: 'Boleto', transferencia: 'Transferência', dinheiro: 'Dinheiro', outro: 'Outro' };
const PAY_CHIP: Record<string, string> = { pago: 'ok', parcial: 'warn', atrasado: 'bad', pendente: '' };
const today = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const num = (v: string) => Number(String(v).replace(/\./g, '').replace(',', '.'));

/** Parcelas, baixas, reajuste e renovação de um contrato ativo (somente leitura nos demais). */
function FinancePanel({ c, canWrite, onRenewed }: { c: any; canWrite: boolean; onRenewed: (id: string) => void }) {
  const toast = useToast(); const { ask, node } = useConfirm();
  const pay = useAsync(() => get(`/api/contracts/${c.id}/payments`), [c.id]);
  const adj = useAsync(() => get(`/api/contracts/${c.id}/adjustments`), [c.id]);
  const [paying, setPaying] = useState<any>(null); const [pf, setPf] = useState<any>({});
  const [mode, setMode] = useState<'' | 'ajuste' | 'renovar'>(''); const [af, setAf] = useState<any>({ percent: '', effective_date: today(), note: '' }); const [rf, setRf] = useState<any>({ new_end_date: '', percent: '', value_amount: '' });
  const [err, setErr] = useState('');
  const run = async (fn: () => Promise<any>, ok: string) => { setErr(''); try { const r = await fn(); toast(ok); pay.reload(); adj.reload(); return r; } catch (e) { setErr(e instanceof ApiError ? (e.body.fields?.[0]?.message ?? e.message) : 'Erro'); } };
  const active = c.status === 'ativo';
  if (!active && c.status !== 'encerrado' && c.status !== 'rescindido') return null;
  return (
    <section className="stack"><h3>Parcelas e pagamentos</h3>
      {err && <div className="alert err" role="alert">{err}</div>}
      {canWrite && active && <div className="row"><button className="btn small" onClick={() => run(() => post(`/api/contracts/${c.id}/payments/generate`), 'Parcelas atualizadas')}>Gerar parcelas do prazo</button>
        <button className="btn small" onClick={() => setMode(mode === 'ajuste' ? '' : 'ajuste')}>Reajustar valor</button>
        <button className="btn small" onClick={() => setMode(mode === 'renovar' ? '' : 'renovar')}>Renovar contrato</button></div>}
      {mode === 'ajuste' && <div className="card stack"><div className="grid g2"><Field label="Percentual (%)"><input inputMode="decimal" placeholder="ex.: 4,5" value={af.percent} onChange={(e) => setAf({ ...af, percent: e.target.value })} /></Field><Field label="Vale a partir de"><input type="date" value={af.effective_date} onChange={(e) => setAf({ ...af, effective_date: e.target.value })} /></Field></div>
        <Field label="Observação (índice, fonte)"><input value={af.note} onChange={(e) => setAf({ ...af, note: e.target.value })} /></Field>
        <p className="small muted">Você informa o percentual (o app não busca índices oficiais). Parcelas já pagas não mudam.</p>
        <button className="btn primary" onClick={async () => { if (await ask(`Reajustar em ${af.percent || 0}% a partir de ${dateBR(af.effective_date)}?`, 'Reajustar')) { const r = await run(() => post(`/api/contracts/${c.id}/adjust`, { percent: num(af.percent), effective_date: af.effective_date, note: af.note || undefined }), 'Reajuste aplicado'); if (r) { setMode(''); c.value_amount = r.new_amount; } } }}>Aplicar reajuste</button></div>}
      {mode === 'renovar' && <div className="card stack"><Field label="Novo fim do contrato"><input type="date" value={rf.new_end_date} onChange={(e) => setRf({ ...rf, new_end_date: e.target.value })} /></Field>
        <div className="grid g2"><Field label="Reajuste na renovação (%)"><input inputMode="decimal" value={rf.percent} onChange={(e) => setRf({ ...rf, percent: e.target.value, value_amount: '' })} /></Field><Field label="ou novo valor (R$)"><input inputMode="decimal" value={rf.value_amount} onChange={(e) => setRf({ ...rf, value_amount: e.target.value, percent: '' })} /></Field></div>
        <p className="small muted">O contrato atual será encerrado como “Renovado” e um novo, já ativo, começa no fim dele. O imóvel continua ocupado.</p>
        <button className="btn primary" onClick={async () => { if (await ask('Renovar este contrato?', 'Renovar')) { const r = await run(() => post(`/api/contracts/${c.id}/renew`, { new_end_date: rf.new_end_date, percent: rf.percent ? num(rf.percent) : undefined, value_amount: rf.value_amount ? num(rf.value_amount) : undefined }), 'Contrato renovado'); if (r) onRenewed(r.id); } }}>Renovar</button></div>}
      {canWrite && active && <div className="row small muted">Multa {Number(c.late_fee_pct ?? 2).toLocaleString('pt-BR')}% + juros {Number(c.late_interest_pct_month ?? 1).toLocaleString('pt-BR')}% ao mês
        <button className="btn small" onClick={async () => { const f = window.prompt('Multa (%)', String(c.late_fee_pct ?? 2)); if (f == null) return; const j = window.prompt('Juros ao mês (%)', String(c.late_interest_pct_month ?? 1)); if (j == null) return; const r = await run(() => api('PATCH', `/api/contracts/${c.id}/late-fees`, { late_fee_pct: num(f), late_interest_pct_month: num(j) }), 'Encargos atualizados'); if (r) { c.late_fee_pct = r.late_fee_pct; c.late_interest_pct_month = r.late_interest_pct_month; } }}>Alterar</button></div>}
      <Async state={pay}>{(rows: any[]) => !rows.length ? <Empty>{active ? 'Sem parcelas ainda. Use “Gerar parcelas do prazo”.' : 'Sem parcelas registradas.'}</Empty> : <div className="list">{rows.map((p) => (
        <div className="item" key={p.id} style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}><b>{dateBR(p.due_date)}</b> · {brl(p.amount)} <span className={`chip ${PAY_CHIP[p.status] ?? ''}`}>{p.status}</span>{!p.generated && <span className="chip">avulsa</span>}
            {p.paid_amount != null && <div className="small muted">Pago {brl(p.paid_amount)} em {dateBR(p.paid_at)} · {METHODS[p.method] ?? p.method ?? '—'}</div>}{p.encargos && p.encargos.total > 0 && <div className="small muted">Encargos estimados: multa {brl(p.encargos.multa)} + juros {brl(p.encargos.juros)} = <b>{brl(p.encargos.total)}</b> (cobrar à parte)</div>}{p.note && <div className="small muted">{p.note}</div>}</div>
          {canWrite && <div className="stack">
            {p.status !== 'pago' && <button className="btn small primary" onClick={() => { setPaying(p); setPf({ paid_amount: String(p.amount).replace('.', ','), paid_at: today(), method: 'pix' }); }}>Dar baixa</button>}
            {p.paid_amount != null && <button className="btn small" onClick={() => run(() => post(`/api/contract-payments/${p.id}/unpay`), 'Baixa desfeita')}>Desfazer</button>}
            {p.paid_amount == null && !p.generated && <button className="btn small" onClick={() => run(() => api('DELETE', `/api/contract-payments/${p.id}`), 'Cobrança excluída')}>Excluir</button>}</div>}
        </div>))}</div>}</Async>
      {paying && <Modal title={`Baixa de ${dateBR(paying.due_date)}`} onClose={() => setPaying(null)}><div className="stack">
        <Field label="Valor recebido (R$)"><input inputMode="decimal" value={pf.paid_amount} onChange={(e) => setPf({ ...pf, paid_amount: e.target.value })} /></Field>
        <div className="grid g2"><Field label="Data"><input type="date" max={today()} value={pf.paid_at} onChange={(e) => setPf({ ...pf, paid_at: e.target.value })} /></Field><Field label="Forma"><select value={pf.method} onChange={(e) => setPf({ ...pf, method: e.target.value })}>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field></div>
        <p className="small muted">Valor menor que a parcela fica como “parcial”.</p>
        <button className="btn primary" onClick={async () => { const r = await run(() => post(`/api/contract-payments/${paying.id}/pay`, { paid_amount: num(pf.paid_amount), paid_at: pf.paid_at, method: pf.method }), 'Pagamento registrado'); if (r) setPaying(null); }}>Registrar</button></div></Modal>}
      <Async state={adj}>{(rows: any[]) => !rows.length ? null : <><h3>Histórico de reajustes</h3><div className="list">{rows.map((a) => <div className="item" key={a.id}><div>{dateBR(a.effective_date)} · <b>{Number(a.percent).toLocaleString('pt-BR')}%</b> · {brl(a.old_amount)} → {brl(a.new_amount)}{a.index_name ? ` (${a.index_name})` : ''}{a.note && <div className="small muted">{a.note}</div>}</div></div>)}</div></>}</Async>
      {node}
    </section>
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
        <FinancePanel c={c} canWrite={w} onRenewed={async (id) => { onChanged(); onClose(); }} />
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
      <PaymentSummary />
      <div className="row" style={{ marginBottom: '.6rem' }}>{[['ativo', 'Ativos'], ['rascunho', 'Rascunhos'], ['encerrado', 'Encerrados'], ['', 'Todos']].map(([k, l]) => <button key={k} className={`btn small ${status === k ? 'primary' : ''}`} onClick={() => setStatus(k)}>{l}</button>)}</div>
      <Async state={st}>{(rows: any[]) => !rows.length ? <Empty>Nenhum contrato aqui. Registre locações e arrendamentos para receber alertas de vencimento e reajuste.</Empty> : <div className="list">{rows.map((c) => <button key={c.id} className="item" style={{ textAlign: 'left' }} onClick={() => setSel(c)}><div style={{ flex: 1 }}><b>{c.property_title}</b><div className="small muted">{L(c.kind)} · {c.counterparty_name} · até {dateBR(c.end_date)}</div></div><div>{brl(c.value_amount)}</div></button>)}</div>}</Async>
      {creating && <ContractForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); st.reload(); }} />}
      {sel && <ContractModal c={sel} onClose={() => setSel(null)} onChanged={st.reload} />}
    </>
  );
}
