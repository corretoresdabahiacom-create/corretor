import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, del, get, patch, post } from '../api';
import { useSession } from '../session';
import { Async, Empty, Field, Modal, useAsync, useConfirm, useToast } from '../ui';
import { brl, dateTimeBR, formatMoneyInput, L, parseMoney } from '../format';

const SOURCES = ['Indicação', 'Site', 'Portal imobiliário', 'Instagram', 'WhatsApp', 'Placa/visita', 'Outro'];

function NewDeal({ onClose, onSaved, presetPerson }: { onClose: () => void; onSaved: (d: any) => void; presetPerson?: string }) {
  const [person, setPerson] = useState(presetPerson ?? '');
  const [personQ, setPersonQ] = useState('');
  const people = useAsync(() => get(`/api/people?q=${encodeURIComponent(personQ)}&pageSize=8&sort=name`), [personQ]);
  const props = useAsync(() => get('/api/properties?status=disponivel&pageSize=100'), []);
  const [chosen, setChosen] = useState<string[]>([]);
  const [f, setF] = useState<any>({ purpose: 'venda', source: '', estimated_value: null, next_action: '' });
  const [err, setErr] = useState<any>(null); const [busy, setBusy] = useState(false);
  const save = async (force = false) => {
    setBusy(true); setErr(null);
    try { onSaved(await post(`/api/deals${force ? '?force=true' : ''}`, { person_id: person, property_ids: chosen, ...f, source: f.source || null, next_action: f.next_action || null })); }
    catch (e) { setErr(e instanceof ApiError ? e : new ApiError(0, 'Erro')); } finally { setBusy(false); }
  };
  return (
    <Modal title="Novo negócio" onClose={onClose}>
      <div className="stack">
        {!presetPerson && <Field label="Pessoa interessada" hint="Busque pelo nome. Cadastre antes em Pessoas se ainda não existir.">
          <input type="search" placeholder="Nome…" value={personQ} onChange={(e) => setPersonQ(e.target.value)} />
          <div className="chips" style={{ marginTop: 6 }}>{(people.data?.items ?? []).map((p: any) => <button type="button" key={p.id} className={`toggle ${person === p.id ? 'on' : ''}`} onClick={() => setPerson(p.id)}>{p.name}</button>)}</div>
        </Field>}
        <Field label="Finalidade"><select value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })}><option value="venda">Compra/venda</option><option value="aluguel">Aluguel</option><option value="temporada">Temporada</option><option value="arrendamento">Arrendamento</option></select></Field>
        <Field label="Imóveis de interesse" hint="Opcional — pode vincular depois.">
          <div className="chips" style={{ maxHeight: 140, overflow: 'auto' }}>{(props.data?.items ?? []).map((p: any) => <button type="button" key={p.id} className={`toggle ${chosen.includes(p.id) ? 'on' : ''}`} onClick={() => setChosen(chosen.includes(p.id) ? chosen.filter((x) => x !== p.id) : [...chosen, p.id])}>{p.code} · {p.title.slice(0, 28)}</button>)}</div>
        </Field>
        <div className="grid g2">
          <Field label="Valor estimado (R$)"><input inputMode="decimal" defaultValue={formatMoneyInput(f.estimated_value)} onChange={(e) => setF({ ...f, estimated_value: parseMoney(e.target.value) })} /></Field>
          <Field label="Origem"><select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}><option value="">—</option>{SOURCES.map((s) => <option key={s}>{s}</option>)}</select></Field>
        </div>
        <Field label="Próxima ação"><input placeholder="Ex.: ligar para confirmar interesse" value={f.next_action} onChange={(e) => setF({ ...f, next_action: e.target.value })} /></Field>
        {err && <div className="alert err" role="alert">{err.message} {err.body?.existing_id && <Link to={`/negocios/${err.body.existing_id}`} onClick={onClose}>Abrir existente</Link>} {err.body?.code === 'DUPLICATE_DEAL' && <button className="btn small" onClick={() => save(true)}>Criar mesmo assim</button>}</div>}
        <button className="btn primary" disabled={!person || busy} onClick={() => save()}>{busy ? 'Salvando…' : 'Criar negócio'}</button>
      </div>
    </Modal>
  );
}

export function Pipeline() {
  const [sp, setSp] = useSearchParams(); const nav = useNavigate(); const toast = useToast(); const { can } = useSession();
  const [creating, setCreating] = useState(sp.get('novo') === '1');
  const [tab, setTab] = useState<'abertas' | 'ganhas' | 'perdidas'>('abertas');
  const stages = useAsync(() => get('/api/pipeline/stages'), []);
  const deals = useAsync(() => get(`/api/deals?status=${tab}`), [tab]);
  return (
    <>
      <div className="row"><h1>Funil de negócios</h1>{can('deals.write') && <button className="btn primary right" onClick={() => setCreating(true)}>+ Novo negócio</button>}</div>
      <div className="tabs">{(['abertas', 'ganhas', 'perdidas'] as const).map((t) => <button key={t} className={`btn small ${tab === t ? 'primary' : ''}`} onClick={() => setTab(t)}>{t === 'abertas' ? 'Em andamento' : t === 'ganhas' ? 'Fechados' : 'Perdidos'}</button>)}</div>
      <Async state={stages}>
        {(st) => (
          <Async state={deals}>
            {(ds) => tab !== 'abertas' ? (
              !ds.length ? <Empty>Nenhum negócio {tab === 'ganhas' ? 'fechado' : 'perdido'} ainda.</Empty> :
              <div className="card list">{ds.map((d: any) => <Link key={d.id} to={`/negocios/${d.id}`}><div style={{ flex: 1 }}><b>{d.person_name}</b><div className="small muted">{L(d.purpose)} · {d.owner_name}</div></div><b>{brl(d.closed_value ?? d.estimated_value)}</b></Link>)}</div>
            ) : (
              <div className="board">
                {st.filter((s: any) => s.kind === 'aberta').map((s: any) => {
                  const col = ds.filter((d: any) => d.stage_key === s.key);
                  return (
                    <div className="col" key={s.key}>
                      <h3><span>{s.label}</span><span className="chip gray">{col.length}</span></h3>
                      {col.map((d: any) => <Link className="deal" to={`/negocios/${d.id}`} key={d.id}><b>{d.person_name}</b><div className="small muted">{L(d.purpose)} · {d.property_count} imóv.</div><div className="small">{brl(d.estimated_value)}</div>{d.next_action && <div className="small muted">➜ {d.next_action}</div>}</Link>)}
                      {!col.length && <div className="small muted" style={{ padding: '.5rem' }}>Vazio</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </Async>
        )}
      </Async>
      {creating && <NewDeal presetPerson={sp.get('pessoa') ?? undefined} onClose={() => { setCreating(false); setSp({}); }} onSaved={(d) => { toast('Negócio criado'); nav(`/negocios/${d.id}`); }} />}
    </>
  );
}

export function DealDetail() {
  const { id } = useParams(); const toast = useToast(); const { can } = useSession(); const { ask, node } = useConfirm();
  const st = useAsync(() => get(`/api/deals/${id}`), [id]);
  const stages = useAsync(() => get('/api/pipeline/stages'), []);
  const [modal, setModal] = useState<null | 'proposal' | 'close' | 'lose' | 'visit'>(null);
  const [note, setNote] = useState('');
  const [val, setVal] = useState<number | null>(null); const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const act = async (fn: () => Promise<any>, ok: string) => { setErr(''); try { await fn(); toast(ok); setModal(null); st.reload(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Erro'); } };
  const move = (key: string) => act(() => post(`/api/deals/${id}/stage`, { stage_key: key }), 'Etapa atualizada');
  return (
    <Async state={st}>
      {(d) => {
        const list = stages.data ?? [];
        const cur = list.find((s: any) => s.key === d.stage_key);
        const open = cur?.kind === 'aberta';
        return (
          <>
            <Link to="/negocios" className="small">← Funil</Link>
            <div className="row"><h1>{d.person?.name}</h1><span className="chip">{cur?.label}</span><span className="chip gray">{L(d.purpose)}</span></div>
            <div className="grid g3">
              <div className="card"><div className="kpi-label">Valor estimado</div><div className="kpi">{brl(d.estimated_value)}</div></div>
              <div className="card"><div className="kpi-label">Valor negociado (proposta aceita)</div><div className="kpi">{brl(d.negotiated_value)}</div></div>
              <div className="card"><div className="kpi-label">Valor fechado</div><div className="kpi">{brl(d.closed_value)}</div></div>
            </div>
            {err && <div className="alert err" role="alert">{err}</div>}
            {open && can('deals.write') && (
              <div className="card stack">
                <h2>Avançar no funil</h2>
                <div className="chips">{list.filter((s: any) => s.kind === 'aberta').map((s: any) => <button key={s.key} className={`toggle ${s.key === d.stage_key ? 'on' : ''}`} disabled={s.key === d.stage_key} onClick={() => move(s.key)}>{s.label}</button>)}</div>
                <div className="row"><button className="btn primary" onClick={() => setModal('close')}>✓ Marcar como fechado</button><button className="btn danger" onClick={() => setModal('lose')}>Perdido</button><button className="btn" onClick={() => setModal('proposal')}>+ Proposta</button><Link className="btn" to={`/agenda?novo=1&negocio=${d.id}&pessoa=${d.person_id}`}>+ Visita</Link></div>
                <p className="small muted">Proposta enviada não é negócio fechado: só “Marcar como fechado”, com o valor efetivo, encerra a venda.</p>
              </div>
            )}
            {!open && can('deals.all') && <button className="btn" onClick={async () => { if (await ask('Reabrir este negócio?', 'Reabrir')) move('negociacao'); }}>Reabrir negócio</button>}
            <div className="grid g2">
              <section className="card"><h2>Imóveis</h2>{!d.properties.length ? <Empty>Nenhum imóvel vinculado.</Empty> : <div className="list">{d.properties.map((p: any) => <Link key={p.id} to={`/imoveis/${p.id}`}>{p.code} · {p.title}<span className="right small">{brl(p.price_sale ?? p.price_rent)}</span></Link>)}</div>}</section>
              <section className="card"><h2>Propostas</h2>{!d.proposals.length ? <Empty>Sem propostas.</Empty> : <div className="list">{d.proposals.map((p: any) => <div className="item" key={p.id}><span>{L(p.direction) === p.direction ? p.direction : p.direction} {brl(p.amount)}</span><span className={`chip right ${p.status === 'aceita' ? 'ok' : p.status === 'recusada' ? 'bad' : 'gray'}`}>{p.status}</span>{p.status === 'enviada' && open && <><button className="btn small" onClick={() => act(() => patch(`/api/deals/${id}/proposals/${p.id}`, { status: 'aceita' }), 'Proposta aceita')}>Aceita</button><button className="btn small" onClick={() => act(() => patch(`/api/deals/${id}/proposals/${p.id}`, { status: 'recusada' }), 'Proposta recusada')}>Recusada</button></>}</div>)}</div>}</section>
            </div>
            <section className="card"><h2>Compromissos</h2>{!d.events.length ? <Empty>Nenhuma visita ou reunião.</Empty> : <div className="list">{d.events.map((e: any) => <Link key={e.id} to="/agenda">{dateTimeBR(e.starts_at)} · {e.title}<span className="chip gray right">{L(e.status)}</span></Link>)}</div>}</section>
            <section className="card"><h2>Histórico</h2>
              {can('deals.write') && <div className="row" style={{ marginBottom: '.5rem' }}><input style={{ flex: 1 }} placeholder="Anotar andamento…" value={note} onChange={(e) => setNote(e.target.value)} /><button className="btn primary" onClick={() => note.trim() && act(async () => { await post(`/api/deals/${id}/activities`, { body: note }); setNote(''); }, 'Anotação salva')}>Salvar</button></div>}
              <div className="list">{d.activities.map((a: any) => <div className="item" key={a.id} style={{ display: 'block' }}><div className="small muted">{dateTimeBR(a.created_at)} · {a.user_name ?? ''} · {a.type}</div>{a.body}</div>)}</div>
            </section>
            {modal === 'close' && <Modal title="Fechar negócio" onClose={() => setModal(null)}><div className="stack"><Field label="Valor efetivamente fechado (R$)" hint="Valor final do negócio concluído."><input autoFocus inputMode="decimal" defaultValue={formatMoneyInput(d.negotiated_value ?? d.estimated_value)} onChange={(e) => setVal(parseMoney(e.target.value))} onFocus={() => setVal(d.negotiated_value ?? d.estimated_value)} /></Field><button className="btn primary" onClick={() => act(() => post(`/api/deals/${id}/stage`, { stage_key: 'fechado', closed_value: val ?? d.negotiated_value ?? d.estimated_value }), 'Negócio fechado 🎉')}>Confirmar fechamento</button></div></Modal>}
            {modal === 'lose' && <Modal title="Negócio perdido" onClose={() => setModal(null)}><div className="stack"><Field label="Motivo da perda"><select value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Selecione…</option>{['Preço', 'Desistiu', 'Comprou com outro corretor', 'Sem crédito aprovado', 'Imóvel indisponível', 'Sem retorno do cliente', 'Outro'].map((m) => <option key={m}>{m}</option>)}</select></Field><button className="btn danger" disabled={!reason} onClick={() => act(() => post(`/api/deals/${id}/stage`, { stage_key: 'perdido', lost_reason: reason }), 'Negócio encerrado')}>Confirmar</button></div></Modal>}
            {modal === 'proposal' && <ProposalModal d={d} onClose={() => setModal(null)} onSave={(b) => act(() => post(`/api/deals/${id}/proposals`, b), 'Proposta registrada')} />}
            {node}
          </>
        );
      }}
    </Async>
  );
}

function ProposalModal({ d, onClose, onSave }: { d: any; onClose: () => void; onSave: (b: any) => void }) {
  const [amount, setAmount] = useState<number | null>(null); const [direction, setDirection] = useState('proposta'); const [pid, setPid] = useState('');
  return (
    <Modal title="Registrar proposta" onClose={onClose}>
      <div className="stack">
        <Field label="Tipo"><select value={direction} onChange={(e) => setDirection(e.target.value)}><option value="proposta">Proposta do cliente</option><option value="contraproposta">Contraproposta do proprietário</option></select></Field>
        <Field label="Valor (R$)"><input autoFocus inputMode="decimal" onChange={(e) => setAmount(parseMoney(e.target.value))} /></Field>
        {d.properties.length > 0 && <Field label="Imóvel"><select value={pid} onChange={(e) => setPid(e.target.value)}><option value="">—</option>{d.properties.map((p: any) => <option key={p.id} value={p.id}>{p.code} · {p.title}</option>)}</select></Field>}
        <button className="btn primary" disabled={!amount} onClick={() => onSave({ direction, amount, property_id: pid || undefined })}>Registrar</button>
      </div>
    </Modal>
  );
}
