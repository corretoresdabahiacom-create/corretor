import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, del, get, patch, post, qs } from '../api';
import { useSession } from '../session';
import { FilesPanel } from './Files';
import { Async, Empty, Field, Modal, MultiToggle, Pager, Spinner, StatusChip, useAsync, useConfirm, useToast } from '../ui';
import { brl, dateTimeBR, L, maskCPFCNPJ, maskPhone } from '../format';

const ROLES: [string, string][] = ['comprador', 'vendedor', 'interessado', 'proprietario', 'locador', 'locatario', 'arrendador', 'arrendatario', 'fiador', 'corretor', 'parceiro', 'contato_referencia'].map((r) => [r, L(r)]);
const SOURCES = ['Indicação', 'Site', 'Portal imobiliário', 'Instagram', 'WhatsApp', 'Placa/visita', 'Outro'];

export function PersonForm({ initial, onSaved, onClose }: { initial?: any; onSaved: (p: any) => void; onClose: () => void }) {
  const edit = !!initial?.id;
  const { can } = useSession();
  const [f, setF] = useState<any>(() => ({
    kind: 'fisica', name: '', display_name: '', roles: [], source: '', private_notes: '', contact_pref: '', relationship_status: 'ativo',
    consent: { contact_ok: true },
    ...initial, phones: initial?.phones?.length ? initial.phones.map(maskPhone) : [''], emails: initial?.emails?.length ? initial.emails : [''],
    document: initial?.document_masked ? '' : initial?.document ? maskCPFCNPJ(initial.document) : '', profile: initial?.profile ?? {},
  }));
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [dups, setDups] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));
  const setProfile = (k: string, v: any) => setF((s: any) => ({ ...s, profile: { ...s.profile, [k]: v } }));
  const isBuyer = f.roles.some((r: string) => ['comprador', 'interessado', 'locatario', 'arrendatario'].includes(r));
  const num = (v: string) => (v === '' ? null : Number(v.replace(/\./g, '').replace(',', '.')));

  const save = async (force = false) => {
    setBusy(true); setMsg(''); setErrors({});
    const body: any = {
      kind: f.kind, name: f.name, display_name: f.display_name || null, phones: f.phones.filter(Boolean), emails: f.emails.filter(Boolean),
      roles: f.roles, source: f.source || null, contact_pref: f.contact_pref || null, relationship_status: f.relationship_status,
      consent: f.consent, profile: isBuyer ? f.profile : {},
    };
    if (!(edit && initial.document_masked)) body.document = f.document || null;
    if (can('people.private_notes')) body.private_notes = f.private_notes || null;
    try {
      const saved = edit ? await patch(`/api/people/${initial.id}`, body) : await post(`/api/people${force ? '?force=true' : ''}`, body);
      onSaved(saved);
    } catch (e) {
      if (e instanceof ApiError && e.body.code === 'POSSIBLE_DUPLICATE') setDups(e.body.duplicates);
      else {
        const fe: Record<string, string> = {};
        (e instanceof ApiError ? e.body.fields ?? [] : []).forEach((x: any) => (fe[x.path.split('.')[0]] = x.message));
        setErrors(fe); setMsg(e instanceof ApiError ? e.message : 'Erro inesperado.');
        if (fe.name || fe.document || fe.phones) setStep(0);
      }
    } finally { setBusy(false); }
  };

  const steps = ['Dados', 'Papéis', ...(isBuyer ? ['Preferências'] : [])];
  return (
    <Modal title={edit ? 'Editar pessoa' : 'Nova pessoa'} onClose={onClose}>
      <div className="steps" aria-hidden>{steps.map((_, i) => <i key={i} className={i <= step ? 'on' : ''} />)}</div>
      <p className="muted small">Etapa {step + 1} de {steps.length}: {steps[step]}</p>
      {dups ? (
        <div className="stack">
          <div className="alert warn">Já existem cadastros parecidos (mesmo telefone, e-mail ou documento). Nada é mesclado automaticamente.</div>
          {dups.map((d) => <Link key={d.id} to={`/pessoas/${d.id}`} className="card" style={{ display: 'block' }} onClick={onClose}><b>{d.name}</b><br /><span className="small muted">{d.phones.join(', ')} {d.emails.join(', ')}</span></Link>)}
          <div className="row"><button className="btn" onClick={() => setDups(null)}>Voltar e revisar</button><button className="btn primary right" disabled={busy} onClick={() => { setDups(null); save(true); }}>Criar mesmo assim</button></div>
        </div>
      ) : (
        <form className="stack" onSubmit={(e: FormEvent) => { e.preventDefault(); step < steps.length - 1 ? setStep(step + 1) : save(); }}>
          {step === 0 && (
            <>
              <div className="row"><label className="toggle"><input type="radio" checked={f.kind === 'fisica'} onChange={() => set('kind', 'fisica')} /> Pessoa física</label><label className="toggle"><input type="radio" checked={f.kind === 'juridica'} onChange={() => set('kind', 'juridica')} /> Empresa</label></div>
              <Field label={f.kind === 'fisica' ? 'Nome completo' : 'Razão social'} error={errors.name}><input required autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
              <Field label="Nome de exibição (opcional)" hint="Nome social ou como a pessoa prefere ser chamada."><input value={f.display_name ?? ''} onChange={(e) => set('display_name', e.target.value)} /></Field>
              {can('people.document') ? (
                <Field label={f.kind === 'fisica' ? 'CPF' : 'CNPJ'} hint={f.kind === 'fisica' ? 'Ex.: 123.456.789-09' : 'Ex.: 12.345.678/0001-95'} error={errors.document}>
                  <input inputMode="numeric" value={f.document} onChange={(e) => set('document', maskCPFCNPJ(e.target.value))} />
                </Field>
              ) : <p className="muted small">O documento só pode ser informado por quem tem permissão.</p>}
              <Field label="Telefone / WhatsApp" hint="Com DDD. Ex.: (19) 99999-1234" error={errors.phones}>
                {f.phones.map((p: string, i: number) => <input key={i} inputMode="tel" style={{ marginBottom: 4 }} value={p} onChange={(e) => set('phones', f.phones.map((x: string, j: number) => (j === i ? maskPhone(e.target.value) : x)))} />)}
                <button type="button" className="btn small" onClick={() => set('phones', [...f.phones, ''])}>+ outro telefone</button>
              </Field>
              <Field label="E-mail" error={errors.emails}>
                {f.emails.map((p: string, i: number) => <input key={i} type="email" style={{ marginBottom: 4 }} value={p} onChange={(e) => set('emails', f.emails.map((x: string, j: number) => (j === i ? e.target.value : x)))} />)}
              </Field>
              <Field label="Origem do contato"><select value={f.source ?? ''} onChange={(e) => set('source', e.target.value)}><option value="">Selecione…</option>{SOURCES.map((s) => <option key={s}>{s}</option>)}</select></Field>
            </>
          )}
          {step === 1 && (
            <>
              <Field label="Papéis desta pessoa" hint="A mesma pessoa pode ter vários papéis sem duplicar o cadastro."><MultiToggle options={ROLES} value={f.roles} onChange={(v) => set('roles', v)} /></Field>
              <Field label="Como prefere ser contatada"><select value={f.contact_pref ?? ''} onChange={(e) => set('contact_pref', e.target.value)}><option value="">Sem preferência</option><option value="whatsapp">WhatsApp</option><option value="telefone">Telefone</option><option value="email">E-mail</option></select></Field>
              <Field label="Situação do relacionamento"><select value={f.relationship_status} onChange={(e) => set('relationship_status', e.target.value)}><option value="ativo">Ativo</option><option value="aguardando_retorno">Aguardando retorno</option><option value="inativo">Inativo</option></select></Field>
              <label className="row"><input type="checkbox" checked={!!f.consent?.contact_ok} onChange={(e) => set('consent', { ...f.consent, contact_ok: e.target.checked })} /> <span className="small">A pessoa concordou em ser contatada sobre imóveis (LGPD — registre apenas se houve consentimento).</span></label>
              {can('people.private_notes') && <Field label="Observações privadas" hint="Visíveis só para quem tem permissão."><textarea value={f.private_notes ?? ''} onChange={(e) => set('private_notes', e.target.value)} /></Field>}
            </>
          )}
          {step === 2 && isBuyer && (
            <>
              <Field label="Procura para"><MultiToggle options={[['venda', 'Comprar'], ['aluguel', 'Alugar'], ['temporada', 'Temporada'], ['arrendamento', 'Arrendar']]} value={f.profile.purposes ?? []} onChange={(v) => setProfile('purposes', v)} /></Field>
              <Field label="Tipos de imóvel"><MultiToggle options={['casa', 'apartamento', 'terreno', 'sala_comercial', 'galpao', 'fazenda', 'sitio', 'chacara', 'terreno_rural'].map((k) => [k, L(k)])} value={f.profile.property_kinds ?? []} onChange={(v) => setProfile('property_kinds', v)} /></Field>
              <div className="grid g2">
                <Field label="Orçamento mínimo (R$)"><input inputMode="decimal" value={f.profile.budget_min ?? ''} onChange={(e) => setProfile('budget_min', num(e.target.value))} /></Field>
                <Field label="Orçamento máximo (R$)"><input inputMode="decimal" value={f.profile.budget_max ?? ''} onChange={(e) => setProfile('budget_max', num(e.target.value))} /></Field>
              </div>
              <Field label="Regiões preferidas" hint="Cidades ou bairros, separados por vírgula."><input value={(f.profile.regions ?? []).join(', ')} onChange={(e) => setProfile('regions', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} /></Field>
              <Field label="Localização desejada"><MultiToggle options={[['litoral', 'Litoral'], ['serra', 'Serra'], ['lago_represa', 'Lago/represa'], ['campo', 'Campo']]} value={f.profile.location_tags ?? []} onChange={(v) => setProfile('location_tags', v)} /></Field>
              <div className="grid g3">
                <Field label="Quartos (mín.)"><input inputMode="numeric" value={f.profile.bedrooms_min ?? ''} onChange={(e) => setProfile('bedrooms_min', num(e.target.value))} /></Field>
                <Field label="Banheiros (mín.)"><input inputMode="numeric" value={f.profile.bathrooms_min ?? ''} onChange={(e) => setProfile('bathrooms_min', num(e.target.value))} /></Field>
                <Field label="Vagas (mín.)"><input inputMode="numeric" value={f.profile.parking_min ?? ''} onChange={(e) => setProfile('parking_min', num(e.target.value))} /></Field>
              </div>
              <div className="grid g2">
                <Field label="Área mínima"><input inputMode="decimal" value={f.profile.area_min ?? ''} onChange={(e) => setProfile('area_min', num(e.target.value))} /></Field>
                <Field label="Unidade"><select value={f.profile.area_unit ?? 'm2'} onChange={(e) => setProfile('area_unit', e.target.value)}><option value="m2">m²</option><option value="ha">hectares</option><option value="alqueire">alqueires</option></select></Field>
              </div>
              <Field label="Finalidade"><select value={f.profile.use ?? ''} onChange={(e) => setProfile('use', e.target.value || undefined)}><option value="">—</option><option value="residencial">Residencial</option><option value="comercial">Comercial</option><option value="rural">Rural</option><option value="investimento">Investimento</option></select></Field>
              <Field label="Prazo para decidir"><input type="date" value={f.profile.decision_deadline ?? ''} onChange={(e) => setProfile('decision_deadline', e.target.value || null)} /></Field>
            </>
          )}
          {msg && <div className="alert err" role="alert">{msg}</div>}
          <div className="row">
            {step > 0 && <button type="button" className="btn" onClick={() => setStep(step - 1)}>Voltar</button>}
            <button className="btn primary right" disabled={busy}>{step < steps.length - 1 ? 'Continuar' : busy ? 'Salvando…' : 'Salvar'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export function PeopleList() {
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const [creating, setCreating] = useState(sp.get('novo') === '1');
  const [filters, setFilters] = useState({ q: '', role: sp.get('role') ?? '', status: sp.get('status') ?? '', page: 1 });
  const st = useAsync(() => get(`/api/people${qs({ ...filters, pageSize: 20 })}`), [JSON.stringify(filters)]);
  const { can } = useSession();
  return (
    <>
      <div className="row"><h1>Pessoas</h1>{can('people.write') && <button className="btn primary right" onClick={() => setCreating(true)}>+ Nova pessoa</button>}</div>
      <div className="card row">
        <input style={{ flex: '2 1 200px' }} type="search" placeholder="Nome, telefone, e-mail ou documento" aria-label="Buscar pessoas" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value, page: 1 })} />
        <select style={{ flex: '1 1 140px' }} aria-label="Filtrar por papel" value={filters.role} onChange={(e) => setFilters({ ...filters, role: e.target.value, page: 1 })}><option value="">Todos os papéis</option>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select style={{ flex: '1 1 140px' }} aria-label="Filtrar por situação" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value, page: 1 })}><option value="">Qualquer situação</option><option value="ativo">Ativo</option><option value="aguardando_retorno">Aguardando retorno</option><option value="inativo">Inativo</option></select>
      </div>
      <Async state={st}>
        {(d) => !d.items.length ? <Empty>Nenhuma pessoa encontrada. {can('people.write') && <button className="btn small" onClick={() => setCreating(true)}>Cadastrar a primeira</button>}</Empty> : (
          <div className="card list">
            {d.items.map((p: any) => (
              <Link key={p.id} to={`/pessoas/${p.id}`}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>{p.display_name || p.name}</b>
                  <div className="chips" style={{ marginTop: 3 }}>{p.roles.map((r: string) => <span key={r} className="chip">{L(r)}</span>)}</div>
                </div>
                <div className="small muted" style={{ textAlign: 'right' }}>{p.phones[0] ? maskPhone(p.phones[0]) : ''}<br /><StatusChip s={p.relationship_status} /></div>
              </Link>
            ))}
            <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={(page) => setFilters({ ...filters, page })} />
          </div>
        )}
      </Async>
      {creating && <PersonForm onClose={() => { setCreating(false); setSp({}); }} onSaved={(p) => { toast('Pessoa cadastrada'); nav(`/pessoas/${p.id}`); }} />}
    </>
  );
}

export function PersonDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { can } = useSession();
  const st = useAsync(() => get(`/api/people/${id}`), [id]);
  const matches = useAsync(() => get(`/api/people/${id}/matches`), [id]);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState('');
  const { ask, node } = useConfirm();
  const addNote = async () => { if (!note.trim()) return; await post(`/api/people/${id}/interactions`, { body: note }); setNote(''); st.reload(); };
  const archive = async () => { if (await ask('Arquivar esta pessoa? Ela deixa de aparecer nas listas, mas o histórico é mantido.', 'Arquivar')) { await del(`/api/people/${id}`); toast('Pessoa arquivada'); nav('/pessoas'); } };
  return (
    <Async state={st}>
      {(p) => (
        <>
          <Link to="/pessoas" className="small">← Pessoas</Link>
          <div className="row"><h1>{p.display_name || p.name}</h1><StatusChip s={p.relationship_status} />{can('people.write') && <><button className="btn small right" onClick={() => setEditing(true)}>Editar</button><button className="btn small danger" onClick={archive}>Arquivar</button></>}</div>
          <div className="chips" style={{ marginBottom: '.6rem' }}>{p.roles.map((r: string) => <span key={r} className="chip">{L(r)}</span>)}</div>
          <div className="grid g2">
            <section className="card stack">
              <h2>Contato</h2>
              {p.phones.map((t: string) => <div key={t}>📞 <a href={`tel:${t}`}>{maskPhone(t)}</a> · <a href={`https://wa.me/55${t.replace(/^55/, '')}`} target="_blank" rel="noreferrer">WhatsApp</a></div>)}
              {p.emails.map((e: string) => <div key={e}>✉️ <a href={`mailto:${e}`}>{e}</a></div>)}
              <div className="small muted">Documento: {p.document ?? '—'} {p.document_masked && '(restrito)'}</div>
              <div className="small muted">Origem: {p.source ?? '—'} · Preferência: {p.contact_pref ?? '—'}</div>
              {p.private_notes && <div className="alert warn small"><b>Observação privada:</b> {p.private_notes}</div>}
            </section>
            <section className="card">
              <h2>Negócios e imóveis</h2>
              {!p.deals.length && !p.owned_properties.length && <Empty>Ainda não há negócios nem imóveis vinculados.</Empty>}
              <div className="list">
                {p.deals.map((d: any) => <Link key={d.id} to={`/negocios/${d.id}`}>Negócio de {L(d.purpose)} <span className="chip gray right">{d.stage_key.replace(/_/g, ' ')}</span></Link>)}
                {p.owned_properties.map((x: any) => <Link key={x.id} to={`/imoveis/${x.id}`}>🏡 {x.code} · {x.title}</Link>)}
              </div>
              {can('deals.write') && <Link className="btn small" to={`/negocios?novo=1&pessoa=${p.id}`}>+ Criar negócio</Link>}
            </section>
          </div>
          {Object.keys(p.profile ?? {}).length > 0 && (
            <section className="card">
              <h2>Imóveis compatíveis</h2>
              <Async state={matches}>
                {(m) => !m.matches.length ? <Empty>Nenhum imóvel disponível combina com as preferências ({brl(p.profile.budget_max)} máx.).</Empty> : (
                  <div className="list">
                    {m.matches.map((x: any) => (
                      <Link key={x.property.id} to={`/imoveis/${x.property.id}`} style={{ alignItems: 'flex-start' }}>
                        <span className="score">{x.score}%</span>
                        <div style={{ flex: 1 }}><b>{x.property.title}</b><div className="small muted">{x.property.city} · {brl(x.property.price_sale ?? x.property.price_rent ?? x.property.price_lease)}</div>
                          <div className="chips" style={{ marginTop: 4 }}>{x.reasons.map((r: string) => <span key={r} className="chip ok">{r}</span>)}{x.mismatches.map((r: string) => <span key={r} className="chip bad">{r}</span>)}</div></div>
                      </Link>
                    ))}
                  </div>
                )}
              </Async>
            </section>
          )}
          {can('people.document') && <FilesPanel base={`/api/people/${id}`} canWrite={can('people.write')} />}
          <section className="card">
            <h2>Histórico</h2>
            {can('people.write') && <div className="row" style={{ marginBottom: '.5rem' }}><input style={{ flex: 1 }} placeholder="Registrar contato, ligação, observação…" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addNote()} /><button className="btn primary" onClick={addNote}>Registrar</button></div>}
            {!p.interactions.length ? <Empty>Sem interações registradas.</Empty> : <div className="list">{p.interactions.map((i: any) => <div className="item" key={i.id} style={{ display: 'block' }}><div className="small muted">{dateTimeBR(i.created_at)} · {i.user_name ?? ''} · {i.type}</div>{i.body}</div>)}</div>}
          </section>
          {editing && <PersonForm initial={p} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); toast('Alterações salvas'); st.reload(); }} />}
          {node}
        </>
      )}
    </Async>
  );
}
