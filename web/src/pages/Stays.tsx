import { useState } from 'react';
import { ApiError, del, get, patch, post } from '../api';
import { Async, Empty, Field, Modal, useAsync, useConfirm, useToast } from '../ui';
import { brl, dateBR } from '../format';

const STATUS: [string, string][] = [['confirmada', 'Confirmada'], ['reserva', 'Reserva (pré)'], ['bloqueio', 'Bloqueio'], ['cancelada', 'Cancelada']];
const today = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Erro inesperado');

export function StaysPanel({ propertyId, canWrite }: { propertyId: string; canWrite: boolean }) {
  const st = useAsync(() => get(`/api/properties/${propertyId}/stays?from=${today()}`), [propertyId]);
  const toast = useToast(); const { ask, node } = useConfirm();
  const [edit, setEdit] = useState<any>(null); const [err, setErr] = useState(''); const [ical, setIcal] = useState('');
  const set = (k: string, v: any) => setEdit((o: any) => ({ ...o, [k]: v }));
  const save = async () => {
    setErr('');
    const body = { guest_name: edit.guest_name || null, guests: edit.guests ? Number(edit.guests) : null, start_date: edit.start_date, end_date: edit.end_date, status: edit.status, source: edit.source || 'direto', total_amount: edit.total_amount ? Number(String(edit.total_amount).replace(',', '.')) : null, deposit_amount: edit.deposit_amount ? Number(String(edit.deposit_amount).replace(',', '.')) : null, notes: edit.notes || null };
    try { if (edit.id) await patch(`/api/stays/${edit.id}`, body); else await post(`/api/properties/${propertyId}/stays`, body); toast('Calendário atualizado'); setEdit(null); st.reload(); }
    catch (e) { setErr(errMsg(e)); }
  };
  const makeIcal = async () => { try { const r = await post(`/api/properties/${propertyId}/ical-token`); setIcal(`${location.origin}${r.path}`); } catch (e) { toast(errMsg(e)); } };
  return (
    <section className="card stack"><div className="row"><h2>Calendário de temporada</h2>{canWrite && <button className="btn small right" onClick={() => setEdit({ status: 'confirmada', source: 'direto', start_date: today(), end_date: '' })}>+ Reserva / bloqueio</button>}</div>
      <Async state={st}>{(rows: any[]) => !rows.length ? <Empty>Nenhuma reserva futura. Datas ocupadas aparecem para os visitantes na página pública.</Empty> : <div className="list">{rows.map((s) => (
        <div className="item" key={s.id} style={{ opacity: s.status === 'cancelada' ? .5 : 1 }}>
          <div style={{ flex: 1 }}><b>{dateBR(s.start_date)} → {dateBR(s.end_date)}</b> · {STATUS.find(([v]) => v === s.status)?.[1]}
            <div className="small muted">{s.guest_person_name ?? s.guest_name ?? 'sem hóspede'}{s.guests ? ` · ${s.guests} hósp.` : ''}{s.total_amount != null ? ` · ${brl(s.total_amount)}` : ''} · {s.source}</div></div>
          {canWrite && <div className="row"><button className="btn small" onClick={() => setEdit({ ...s, start_date: String(s.start_date).slice(0, 10), end_date: String(s.end_date).slice(0, 10) })}>Editar</button>
            <button className="btn small danger" onClick={async () => { if (await ask('Excluir esta reserva?', 'Excluir')) { try { await del(`/api/stays/${s.id}`); st.reload(); } catch (e) { toast(errMsg(e)); } } }}>Excluir</button></div>}
        </div>))}</div>}</Async>
      {canWrite && <div className="stack">
        <div className="row"><button className="btn small" onClick={makeIcal}>Gerar link iCal (Airbnb, Booking, Google Agenda)</button>
          {ical && <button className="btn small danger" onClick={async () => { await del(`/api/properties/${propertyId}/ical-token`); setIcal(''); toast('Link revogado'); }}>Revogar link</button>}</div>
        {ical && <><input readOnly value={ical} onFocus={(e) => e.target.select()} aria-label="Link iCal" /><p className="small muted">Cole este endereço no outro site para importar a ocupação (só datas, sem dados de hóspedes). Gerar um novo link invalida o anterior; guarde este agora, ele não é exibido de novo.</p></>}
      </div>}
      {edit && <Modal title={edit.id ? 'Editar reserva' : 'Nova reserva / bloqueio'} onClose={() => setEdit(null)}><div className="stack">
        <Field label="Tipo"><select value={edit.status} onChange={(e) => set('status', e.target.value)}>{STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <div className="row"><Field label="Check-in"><input type="date" value={edit.start_date ?? ''} onChange={(e) => set('start_date', e.target.value)} /></Field><Field label="Check-out"><input type="date" value={edit.end_date ?? ''} onChange={(e) => set('end_date', e.target.value)} /></Field></div>
        <Field label="Hóspede"><input value={edit.guest_name ?? ''} onChange={(e) => set('guest_name', e.target.value)} /></Field>
        <div className="row"><Field label="Nº de hóspedes"><input inputMode="numeric" value={edit.guests ?? ''} onChange={(e) => set('guests', e.target.value)} /></Field><Field label="Origem"><input value={edit.source ?? ''} onChange={(e) => set('source', e.target.value)} placeholder="direto, Airbnb…" /></Field></div>
        <div className="row"><Field label="Valor total (R$)"><input inputMode="decimal" value={edit.total_amount ?? ''} onChange={(e) => set('total_amount', e.target.value)} /></Field><Field label="Sinal (R$)"><input inputMode="decimal" value={edit.deposit_amount ?? ''} onChange={(e) => set('deposit_amount', e.target.value)} /></Field></div>
        <Field label="Observações"><textarea value={edit.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
        {err && <div className="alert err" role="alert">{err}</div>}
        <button className="btn primary" onClick={save}>Salvar</button></div></Modal>}
      {node}
    </section>
  );
}
