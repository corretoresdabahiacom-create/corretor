import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, del, get, patch, post } from '../api';
import { useSession } from '../session';
import { Async, Empty, Field, Modal, StatusChip, useAsync, useToast } from '../ui';
import { dateTimeBR, L, timeBR } from '../format';

const TYPES = ['visita', 'reuniao', 'captacao', 'avaliacao', 'vistoria', 'assinatura', 'retorno', 'tarefa', 'vencimento', 'outro'];
const pad = (n: number) => String(n).padStart(2, '0');
const toLocalInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

function EventForm({ initial, onClose, onSaved }: { initial?: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const edit = !!initial?.id;
  const base = initial?.starts_at ? new Date(initial.starts_at) : (() => { const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return d; })();
  const [f, setF] = useState<any>({
    type: 'visita', title: '', location: '', instructions: '', person_id: '', property_id: '', deal_id: '', ...initial,
    start: toLocalInput(base), end: toLocalInput(initial?.ends_at ? new Date(initial.ends_at) : new Date(base.getTime() + 3600_000)),
  });
  const people = useAsync(() => get('/api/people?pageSize=100&sort=name'), []);
  const props = useAsync(() => get('/api/properties?pageSize=100'), []);
  const [conf, setConf] = useState<any[] | null>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));
  const save = async (force = false) => {
    setBusy(true); setErr(''); setConf(null);
    const body: any = { type: f.type, title: f.title || L(f.type), starts_at: new Date(f.start).toISOString(), ends_at: new Date(f.end).toISOString(), location: f.location || null, instructions: f.instructions || null, person_id: f.person_id || null, property_id: f.property_id || null, deal_id: f.deal_id || null };
    try { edit ? await patch(`/api/events/${initial.id}${force ? '?force=true' : ''}`, body) : await post(`/api/events${force ? '?force=true' : ''}`, body); toast('Compromisso salvo'); onSaved(); }
    catch (e) { if (e instanceof ApiError && e.body.code === 'CONFLICT') setConf(e.body.conflicts); else setErr(e instanceof ApiError ? e.message : 'Erro'); } finally { setBusy(false); }
  };
  return (
    <Modal title={edit ? 'Editar compromisso' : 'Novo compromisso'} onClose={onClose}>
      <div className="stack">
        <Field label="Tipo"><select value={f.type} onChange={(e) => set('type', e.target.value)}>{TYPES.map((t) => <option key={t} value={t}>{L(t)}</option>)}</select></Field>
        <Field label="Título" hint={`Se vazio, usamos “${L(f.type)}”.`}><input value={f.title} onChange={(e) => set('title', e.target.value)} /></Field>
        <div className="grid g2"><Field label="Início"><input type="datetime-local" value={f.start} onChange={(e) => { const d = new Date(e.target.value); setF((s: any) => ({ ...s, start: e.target.value, end: toLocalInput(new Date(d.getTime() + 3600_000)) })); }} /></Field><Field label="Fim"><input type="datetime-local" value={f.end} onChange={(e) => set('end', e.target.value)} /></Field></div>
        <Field label="Pessoa"><select value={f.person_id ?? ''} onChange={(e) => set('person_id', e.target.value)}><option value="">—</option>{(people.data?.items ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Imóvel"><select value={f.property_id ?? ''} onChange={(e) => { set('property_id', e.target.value); const p = (props.data?.items ?? []).find((x: any) => x.id === e.target.value); if (p && !f.location) set('location', [p.address?.logradouro, p.city].filter(Boolean).join(', ')); }}><option value="">—</option>{(props.data?.items ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.code} · {p.title}</option>)}</select></Field>
        <Field label="Endereço / local"><input value={f.location ?? ''} onChange={(e) => set('location', e.target.value)} /></Field>
        <Field label="Instruções"><textarea value={f.instructions ?? ''} onChange={(e) => set('instructions', e.target.value)} /></Field>
        {conf && <div className="alert warn" role="alert"><b>Conflito de horário:</b>{conf.map((c) => <div key={c.id}>• {c.title} ({timeBR(c.starts_at)}–{timeBR(c.ends_at)}){c.owner_name ? ` — ${c.owner_name}` : ''}</div>)}<button className="btn small" onClick={() => save(true)}>Agendar mesmo assim</button></div>}
        {err && <div className="alert err" role="alert">{err}</div>}
        <button className="btn primary" disabled={busy} onClick={() => save()}>{busy ? 'Salvando…' : 'Salvar'}</button>
      </div>
    </Modal>
  );
}

function EventModal({ ev, onClose, onChanged }: { ev: any; onClose: () => void; onChanged: () => void }) {
  const { can } = useSession(); const toast = useToast();
  const det = useAsync(() => get(`/api/events/${ev.id}`), [ev.id]);
  const [mode, setMode] = useState<'' | 'complete' | 'resched' | 'cancel' | 'edit'>(''); const [err, setErr] = useState('');
  const [outcome, setOutcome] = useState(''); const [next, setNext] = useState(''); const [reason, setReason] = useState('');
  const [rs, setRs] = useState({ start: toLocalInput(new Date(ev.starts_at)), end: toLocalInput(new Date(ev.ends_at)) });
  const [conf, setConf] = useState(false);
  const run = async (fn: () => Promise<any>, ok: string) => { setErr(''); setConf(false); try { await fn(); toast(ok); onChanged(); onClose(); } catch (e) { if (e instanceof ApiError && e.body.code === 'CONFLICT') setConf(true); else setErr(e instanceof ApiError ? e.message : 'Erro'); } };
  if (mode === 'edit') return <EventForm initial={det.data ?? ev} onClose={onClose} onSaved={() => { onChanged(); onClose(); }} />;
  const active = ev.status === 'agendado' && can('events.write');
  const resched = (force: boolean) => run(() => post(`/api/events/${ev.id}/reschedule${force ? '?force=true' : ''}`, { starts_at: new Date(rs.start).toISOString(), ends_at: new Date(rs.end).toISOString(), reason }), 'Reagendado');
  return (
    <Modal title={ev.title} onClose={onClose}>
      <div className="stack">
        <div className="chips"><span className="chip">{L(ev.type)}</span><StatusChip s={ev.status} /></div>
        <div>🕒 {dateTimeBR(ev.starts_at)} – {timeBR(ev.ends_at)}</div>
        {ev.location && <div>📍 {ev.location} · <a target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ev.location)}`}>abrir no mapa</a></div>}
        {ev.person_name && <div>👤 {ev.person_name}</div>}{ev.property_title && <div>🏡 {ev.property_code} · {ev.property_title}</div>}
        {ev.instructions && <div className="muted">{ev.instructions}</div>}
        {ev.outcome && <div className="alert ok"><b>Resultado:</b> {ev.outcome}{ev.next_action ? ` · Próxima ação: ${ev.next_action}` : ''}</div>}
        {err && <div className="alert err" role="alert">{err}</div>}
        {active && !mode && <div className="row"><button className="btn primary" onClick={() => setMode('complete')}>✓ Concluir</button><button className="btn" onClick={() => setMode('resched')}>Reagendar</button><button className="btn" onClick={() => setMode('edit')}>Editar</button><button className="btn danger" onClick={() => setMode('cancel')}>Cancelar</button></div>}
        {mode === 'complete' && <><Field label={ev.type === 'visita' ? 'Como foi a visita?' : 'Resultado'}><textarea autoFocus value={outcome} onChange={(e) => setOutcome(e.target.value)} /></Field><Field label="Próxima ação"><input value={next} onChange={(e) => setNext(e.target.value)} /></Field><button className="btn primary" disabled={!outcome.trim()} onClick={() => run(() => post(`/api/events/${ev.id}/complete`, { outcome, next_action: next || undefined }), 'Concluído')}>Salvar resultado</button></>}
        {mode === 'resched' && <><div className="grid g2"><Field label="Novo início"><input type="datetime-local" value={rs.start} onChange={(e) => { setRs({ start: e.target.value, end: toLocalInput(new Date(new Date(e.target.value).getTime() + (new Date(ev.ends_at).getTime() - new Date(ev.starts_at).getTime()))) }); }} /></Field><Field label="Novo fim"><input type="datetime-local" value={rs.end} onChange={(e) => setRs({ ...rs, end: e.target.value })} /></Field></div><Field label="Motivo (opcional)"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>{conf && <div className="alert warn">Há conflito de horário. <button className="btn small" onClick={() => resched(true)}>Reagendar mesmo assim</button></div>}<button className="btn primary" onClick={() => resched(false)}>Reagendar</button></>}
        {mode === 'cancel' && <><div className="alert warn">Cancelar este compromisso? O histórico é mantido.</div><Field label="Motivo (opcional)"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field><div className="row"><button className="btn" onClick={() => setMode('')}>Voltar</button><button className="btn danger right" onClick={() => run(() => post(`/api/events/${ev.id}/cancel`, { reason }), 'Cancelado')}>Cancelar compromisso</button></div></>}
        <Async state={det}>{(d) => <details><summary className="small">Histórico de alterações</summary>{d.history.map((h: any) => <div key={h.id} className="small muted">{dateTimeBR(h.created_at)} · {h.action} · {h.user_name}</div>)}</details>}</Async>
      </div>
    </Modal>
  );
}

function Subscribe({ onClose }: { onClose: () => void }) {
  const toast = useToast(); const [url, setUrl] = useState('');
  const gen = async () => { const r = await post('/api/calendar/token', {}); setUrl(r.url); };
  return (
    <Modal title="Ver minha agenda no Google Agenda ou celular" onClose={onClose}>
      <div className="stack">
        <p className="small">Gera um link privado só de leitura. No Google Agenda: <b>Outras agendas → Do URL</b>, e cole o link. Os compromissos aparecem lá (a atualização pode levar algumas horas).</p>
        {!url ? <button className="btn primary" onClick={gen}>Gerar link</button> : <><input readOnly value={url} onFocus={(e) => e.target.select()} /><button className="btn" onClick={() => { navigator.clipboard?.writeText(url); toast('Link copiado'); }}>Copiar</button><div className="alert warn small">Guarde este link: ele não será mostrado de novo. Quem o tiver vê seus compromissos. Gerar outro invalida o anterior.</div></>}
        <button className="btn danger small" onClick={async () => { await del('/api/calendar/token'); setUrl(''); toast('Link desativado'); }}>Desativar link atual</button>
      </div>
    </Modal>
  );
}

export default function Agenda() {
  const [sp, setSp] = useSearchParams(); const { can } = useSession();
  const [view, setView] = useState<'dia' | 'semana' | 'mes' | 'lista'>('semana');
  const [cursor, setCursor] = useState(startOfDay(new Date()));
  const [creating, setCreating] = useState<any>(sp.get('novo') === '1' ? { type: sp.get('negocio') ? 'visita' : 'visita', deal_id: sp.get('negocio') ?? '', person_id: sp.get('pessoa') ?? '' } : null);
  const [sel, setSel] = useState<any>(null); const [subscribe, setSubscribe] = useState(false);
  const range = (() => {
    if (view === 'dia') return [cursor, addDays(cursor, 1)];
    if (view === 'semana') { const s = addDays(cursor, -cursor.getDay()); return [s, addDays(s, 7)]; }
    if (view === 'mes') { const f = new Date(cursor.getFullYear(), cursor.getMonth(), 1); const s = addDays(f, -f.getDay()); return [s, addDays(s, 42)]; }
    return [startOfDay(new Date()), addDays(startOfDay(new Date()), 60)];
  })();
  const st = useAsync(() => get(`/api/events?from=${encodeURIComponent(range[0].toISOString())}&to=${encodeURIComponent(range[1].toISOString())}`), [view, cursor.getTime()]);
  const step = (n: number) => setCursor(view === 'mes' ? new Date(cursor.getFullYear(), cursor.getMonth() + n, 1) : addDays(cursor, n * (view === 'semana' ? 7 : 1)));
  const Item = ({ e }: { e: any }) => <button className="deal" style={{ width: '100%', textAlign: 'left', opacity: e.status === 'cancelado' ? .5 : 1 }} onClick={() => setSel(e)}><b>{timeBR(e.starts_at)}</b> {e.title}<div className="small muted">{L(e.type)}{e.person_name ? ` · ${e.person_name}` : ''}{e.status !== 'agendado' ? ` · ${L(e.status)}` : ''}</div></button>;
  const label = view === 'mes' ? cursor.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : view === 'dia' ? cursor.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }) : view === 'semana' ? `${range[0].toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} – ${addDays(range[1], -1).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}` : 'Próximos 60 dias';
  return (
    <>
      <div className="row"><h1>Agenda</h1><button className="btn small right" onClick={() => setSubscribe(true)}>📲 Assinar</button>{can('events.write') && <button className="btn primary" onClick={() => setCreating({})}>+ Compromisso</button>}</div>
      <div className="row" style={{ marginBottom: '.6rem' }}>
        {(['dia', 'semana', 'mes', 'lista'] as const).map((v) => <button key={v} className={`btn small ${view === v ? 'primary' : ''}`} onClick={() => setView(v)}>{v === 'mes' ? 'Mês' : v[0].toUpperCase() + v.slice(1)}</button>)}
        {view !== 'lista' && <><button className="btn small right" onClick={() => step(-1)} aria-label="Anterior">‹</button><button className="btn small" onClick={() => setCursor(startOfDay(new Date()))}>Hoje</button><button className="btn small" onClick={() => step(1)} aria-label="Próximo">›</button></>}
      </div>
      <h2 style={{ textTransform: 'capitalize' }}>{label}</h2>
      <Async state={st}>
        {(evs: any[]) => {
          if (view === 'mes') {
            const days = Array.from({ length: 42 }, (_, i) => addDays(range[0], i));
            return <><div className="cal" aria-hidden>{['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => <b key={i} className="small muted" style={{ textAlign: 'center' }}>{d}</b>)}</div><div className="cal">{days.map((d) => { const de = evs.filter((e) => sameDay(new Date(e.starts_at), d)); return <button key={d.toISOString()} className={`d ${d.getMonth() !== cursor.getMonth() ? 'out' : ''} ${sameDay(d, new Date()) ? 'today' : ''}`} onClick={() => { setCursor(d); setView('dia'); }} aria-label={`${d.toLocaleDateString('pt-BR')}: ${de.length} compromissos`}><b>{d.getDate()}</b>{de.slice(0, 2).map((e) => <span key={e.id} className="dot">{timeBR(e.starts_at)} {e.title}</span>)}{de.length > 2 && <span className="small muted">+{de.length - 2}</span>}</button>; })}</div></>;
          }
          if (view === 'lista') return !evs.length ? <Empty>Nenhum compromisso nos próximos 60 dias.</Empty> : <div className="card">{evs.map((e) => <div key={e.id} style={{ padding: '.2rem 0' }}><div className="small muted">{new Date(e.starts_at).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}</div><Item e={e} /></div>)}</div>;
          const days = view === 'dia' ? [cursor] : Array.from({ length: 7 }, (_, i) => addDays(range[0], i));
          return <div className="grid" style={{ gridTemplateColumns: view === 'dia' ? '1fr' : 'repeat(auto-fit,minmax(150px,1fr))' }}>{days.map((d) => { const de = evs.filter((e) => sameDay(new Date(e.starts_at), d)); return <div key={d.toISOString()} className="card" style={{ marginBottom: 0, borderColor: sameDay(d, new Date()) ? 'var(--brand)' : undefined }}><h3 style={{ textTransform: 'capitalize' }}>{d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' })}</h3>{!de.length ? <span className="small muted">Livre</span> : de.map((e) => <Item key={e.id} e={e} />)}</div>; })}</div>;
        }}
      </Async>
      {creating && <EventForm initial={creating} onClose={() => { setCreating(null); setSp({}); }} onSaved={() => { setCreating(null); setSp({}); st.reload(); }} />}
      {subscribe && <Subscribe onClose={() => setSubscribe(false)} />}
      {sel && <EventModal ev={sel} onClose={() => setSel(null)} onChanged={st.reload} />}
    </>
  );
}
