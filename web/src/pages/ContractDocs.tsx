import { useEffect, useState } from 'react';
import { ApiError, del, get, patch, post } from '../api';
import { Async, Empty, Field, Modal, useAsync, useConfirm, useToast } from '../ui';
import { dateTimeBR } from '../format';

const STATUS: Record<string, [string, string]> = { rascunho: ['Rascunho', 'warn'], finalizado: ['Finalizado', 'ok'], assinado: ['Assinado', 'ok'] };
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Erro inesperado.');

/** Histórico de contratos da pasta do cliente: criar de um modelo, editar, copiar, compartilhar e excluir. Só para quem tem permissão. */
export function ContractDocsPanel({ personId }: { personId: string }) {
  const list = useAsync(() => get(`/api/people/${personId}/contract-docs`), [personId]);
  const toast = useToast(); const { ask, node } = useConfirm();
  const [creating, setCreating] = useState(false); const [openId, setOpenId] = useState<string | null>(null);
  const copy = async (d: any) => { try { await post(`/api/contract-docs/${d.id}/copy`, {}); toast('Cópia criada como rascunho'); list.reload(); } catch (e) { toast(errMsg(e)); } };
  const remove = async (d: any) => { if (await ask(`Excluir “${d.title}”? O texto, as versões e os links compartilhados serão apagados. Esta ação não pode ser desfeita.`, 'Excluir')) { try { await del(`/api/contract-docs/${d.id}`); toast('Documento excluído'); list.reload(); } catch (e) { toast(errMsg(e)); } } };
  return (
    <section className="card stack" id="contratos-cliente">
      <div className="row"><h2>Contratos do cliente</h2><button className="btn small primary right" onClick={() => setCreating(true)}>+ Novo contrato</button></div>
      <p className="small muted">Modelos prontos (corretagem, locação, compra e venda, arrendamento, avaliação). Só administrador, gestor e corretor veem esta área.</p>
      <Async state={list}>{(rows: any[]) => !rows.length ? <Empty>Nenhum contrato criado para este cliente.</Empty> : (
        <div className="list">{rows.map((d) => (
          <div className="item" key={d.id} style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <b>{d.template_title}</b> <span className={`chip ${STATUS[d.status]?.[1] ?? 'gray'}`}>{STATUS[d.status]?.[0] ?? d.status}</span>{d.shares_ativos > 0 && <span className="chip gray">🔗 {d.shares_ativos} link(s)</span>}
              <div className="small muted">{d.property_title ? `${d.property_code} · ${d.property_title} · ` : ''}Atualizado em {dateTimeBR(d.updated_at)}</div>
            </div>
            <div className="row small"><button className="btn small" onClick={() => setOpenId(d.id)}>Abrir</button><button className="btn small" onClick={() => copy(d)}>Copiar</button><button className="btn small danger" onClick={() => remove(d)} aria-label="Excluir contrato">Excluir</button></div>
          </div>))}</div>)}
      </Async>
      {creating && <NewDoc personId={personId} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); list.reload(); setOpenId(id); }} />}
      {openId && <DocEditor id={openId} onClose={() => { setOpenId(null); list.reload(); }} />}
      {node}
    </section>
  );
}

function NewDoc({ personId, onClose, onCreated }: { personId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const cat = useAsync(() => get('/api/doc-templates'), []);
  const props = useAsync(() => get('/api/properties?pageSize=100'), []);
  const [key, setKey] = useState(''); const [side, setSide] = useState<'a' | 'b'>('a'); const [prop, setProp] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const go = async () => { setBusy(true); setErr(''); try { const r = await post(`/api/people/${personId}/contract-docs`, { template_key: key, side, property_id: prop || null }); onCreated(r.id); } catch (e) { setErr(errMsg(e)); setBusy(false); } };
  return (
    <Modal title="Novo contrato" onClose={onClose} wide>
      <Async state={cat}>{(c: any) => {
        const sel = c.modelos.find((m: any) => m.key === key);
        return (<div className="stack">
          <div className="alert warn small">{c.aviso}</div>
          {Object.entries(c.categorias as Record<string, string>).map(([k, label]) => (
            <div key={k} className="stack"><h3>{label}</h3>
              <div className="list">{c.modelos.filter((m: any) => m.category === k).map((m: any) => (
                <div className="item" key={m.key} style={{ cursor: 'pointer', background: key === m.key ? 'var(--brand-soft)' : undefined }} onClick={() => { setKey(m.key); setSide('a'); }}>
                  <input type="radio" name="modelo" checked={key === m.key} onChange={() => { setKey(m.key); setSide('a'); }} aria-label={m.title} />
                  <div style={{ flex: 1 }}><b>{m.title}</b><div className="small muted">{m.summary}</div></div></div>))}</div></div>))}
          {sel && <div className="stack">
            {sel.two_sides && <Field label="Este cliente é"><select value={side} onChange={(e) => setSide(e.target.value as 'a' | 'b')}><option value="a">{sel.sides.a}</option><option value="b">{sel.sides.b}</option></select></Field>}
            <Field label="Imóvel (opcional: preenche endereço e valores)"><select value={prop} onChange={(e) => setProp(e.target.value)}><option value="">— não informar —</option>{(props.data?.items ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.code} · {p.title}</option>)}</select></Field>
            <div className="alert warn small"><b>Atenção:</b><ul style={{ margin: '.3rem 0 0 1rem' }}>{sel.warnings.map((w: string) => <li key={w}>{w}</li>)}</ul></div>
          </div>}
          <p className="small muted">Fontes consultadas em {c.consultado_em?.split('-').reverse().join('/')}: {c.fontes.map((f: any, i: number) => <span key={f.url}>{i ? ' · ' : ''}<a href={f.url} target="_blank" rel="noreferrer">{f.name.split(' — ')[0]}</a></span>)}.</p>
          {err && <div className="alert err" role="alert">{err}</div>}
          <div className="row"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary right" disabled={!key || busy} onClick={go}>{busy ? 'Criando…' : 'Criar contrato'}</button></div>
        </div>);
      }}</Async>
    </Modal>
  );
}

function DocEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const st = useAsync(() => get(`/api/contract-docs/${id}`), [id]);
  const toast = useToast(); const { ask, node } = useConfirm();
  const [tab, setTab] = useState<'texto' | 'campos' | 'historico' | 'compartilhar'>('texto');
  const [title, setTitle] = useState(''); const [body, setBody] = useState(''); const [data, setData] = useState<Record<string, string>>({}); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const d = st.data as any;
  useEffect(() => { if (d) { setTitle(d.title); setBody(d.body); setData(d.data ?? {}); } }, [d?.id, d?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <Modal title="Contrato" onClose={onClose} wide><Async state={st}>{() => null}</Async></Modal>;
  const locked = d.status !== 'rascunho'; const dirty = title !== d.title || body !== d.body;
  const run = async (fn: () => Promise<any>, ok: string) => { setBusy(true); setErr(''); try { const r = await fn(); toast(ok); st.reload(); return r; } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } };
  const close = async () => { if (dirty && !(await ask('Há alterações não salvas. Sair mesmo assim?', 'Sair sem salvar'))) return; onClose(); };
  return (
    <Modal title={d.template?.title ?? 'Contrato'} onClose={close} wide>
      <div className="stack">
        {d.template?.outdated && <div className="alert warn small">Este documento foi criado com uma versão anterior do modelo. Revise antes de usar.</div>}
        {err && <div className="alert err" role="alert">{err}</div>}
        <div className="row">
          <input style={{ flex: 1, minWidth: 200 }} aria-label="Título" value={title} disabled={locked} onChange={(e) => setTitle(e.target.value)} />
          <select aria-label="Situação" value={d.status} disabled={busy || dirty} title={dirty ? 'Salve as alterações antes de mudar a situação' : ''} style={{ width: 'auto' }} onChange={(e) => run(() => patch(`/api/contract-docs/${id}`, { status: e.target.value }), 'Situação atualizada')}>
            <option value="rascunho">Rascunho (editável)</option><option value="finalizado">Finalizado</option><option value="assinado">Assinado</option></select>
        </div>
        {locked && <p className="small muted">Documento {STATUS[d.status][0].toLowerCase()}: para editar o texto, volte a situação para “Rascunho”.</p>}
        <div className="tabs2" role="tablist">{([['texto', 'Texto'], ['campos', 'Campos'], ['historico', `Histórico (${d.versions.length})`], ['compartilhar', 'Compartilhar']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>

        {tab === 'texto' && <>
          <textarea className="docbody" aria-label="Texto do contrato" value={body} readOnly={locked} onChange={(e) => setBody(e.target.value)} />
          <p className="small muted">Linhas com ________ são para preencher à mão ou aqui no texto. Revise tudo com um advogado antes de assinar.</p>
          <div className="row"><button className="btn" onClick={() => window.open(`/api/contract-docs/${id}/print`, '_blank', 'noopener')}>Imprimir / salvar PDF</button>
            <button className="btn primary right" disabled={!dirty || busy || locked} onClick={() => run(() => patch(`/api/contract-docs/${id}`, { title, body }), 'Alterações salvas')}>{busy ? 'Salvando…' : 'Salvar alterações'}</button></div></>}

        {tab === 'campos' && <FieldsTab d={d} data={data} setData={setData} locked={locked} busy={busy} onRegenerate={async () => { if (await ask('Atualizar o texto com estes campos? Edições feitas à mão no texto serão substituídas (a versão atual fica no Histórico).', 'Atualizar texto')) run(() => patch(`/api/contract-docs/${id}`, { data, regenerate: true }), 'Texto atualizado'); }} />}

        {tab === 'historico' && (!d.versions.length ? <Empty>Ainda sem versões anteriores. Elas são guardadas a cada alteração (últimas 30).</Empty> : <div className="list">{d.versions.map((v: any) => (
          <div className="item" key={v.id}><div style={{ flex: 1 }}>{dateTimeBR(v.saved_at)} <span className="small muted">· {v.saved_by_name ?? '—'} · {STATUS[v.status]?.[0] ?? v.status}</span></div>
            <button className="btn small" disabled={locked || busy} onClick={async () => { if (await ask('Voltar a esta versão? O texto atual fica guardado no Histórico.', 'Restaurar')) run(() => post(`/api/contract-docs/${id}/restore`, { version_id: v.id }), 'Versão restaurada'); }}>Restaurar</button></div>))}</div>)}

        {tab === 'compartilhar' && <ShareTab d={d} onChange={() => st.reload()} onCopied={toast} />}
        {node}
      </div>
    </Modal>
  );
}

function FieldsTab({ d, data, setData, locked, busy, onRegenerate }: any) {
  const fields: any[] = d.template?.fields ?? []; const groups = [...new Set(fields.map((f) => f.group))] as string[];
  if (!fields.length) return <Empty>O modelo deste documento não existe mais; edite só o texto.</Empty>;
  return (<div className="stack">
    {groups.map((g) => <div key={g} className="stack"><h3>{g}</h3><div className="grid g2">{fields.filter((f) => f.group === g).map((f) => (
      <Field key={f.key} label={f.label} hint={f.hint}>
        {f.type === 'select' ? <select value={data[f.key] ?? ''} disabled={locked} onChange={(e) => setData({ ...data, [f.key]: e.target.value })}>{f.options.map(([v, l]: [string, string]) => <option key={v} value={v}>{l}</option>)}</select>
          : f.type === 'textarea' ? <textarea rows={3} value={data[f.key] ?? ''} disabled={locked} onChange={(e) => setData({ ...data, [f.key]: e.target.value })} />
          : <input type={f.type === 'date' ? 'date' : 'text'} inputMode={f.type === 'money' || f.type === 'number' ? 'decimal' : undefined} placeholder={f.type === 'money' ? 'ex.: 450000' : undefined} value={data[f.key] ?? ''} disabled={locked} onChange={(e) => setData({ ...data, [f.key]: e.target.value })} />}
      </Field>))}</div></div>)}
    <div className="row"><span className="small muted">Valores em reais sem pontos (ex.: 2500 ou 2500.50). O texto muda só depois de “Atualizar texto”.</span><button className="btn primary right" disabled={locked || busy} onClick={onRegenerate}>Atualizar texto com estes campos</button></div>
  </div>);
}

function ShareTab({ d, onChange, onCopied }: { d: any; onChange: () => void; onCopied: (m: string) => void }) {
  const [days, setDays] = useState('7'); const [link, setLink] = useState<string | null>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState(''); const people = useAsync(() => get('/api/people?pageSize=100'), []);
  const msg = (u: string) => `Olá! Segue o contrato “${d.title}” para conferência (link válido por ${days} dia(s)): ${u}`;
  const create = async () => { setBusy(true); setErr(''); try { const r = await post(`/api/contract-docs/${d.id}/shares`, { days: Number(days) }); setLink(r.url); onChange(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } };
  const copyLink = async () => { try { await navigator.clipboard.writeText(link!); onCopied('Link copiado'); } catch { onCopied('Não consegui copiar: selecione o link e copie.'); } };
  return (<div className="stack">
    {err && <div className="alert err" role="alert">{err}</div>}
    <p className="small muted">O link abre só para leitura, sem login, e expira. Quem receber o link vê o texto inteiro (inclui CPF e endereço): envie apenas para as partes. Você pode cancelar a qualquer momento.</p>
    <div className="row"><select aria-label="Validade do link" value={days} onChange={(e) => setDays(e.target.value)} style={{ width: 'auto' }}>{[['1', '1 dia'], ['3', '3 dias'], ['7', '7 dias'], ['15', '15 dias'], ['30', '30 dias']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select><button className="btn primary" disabled={busy} onClick={create}>Gerar link</button></div>
    {link && <div className="alert ok"><div className="small">Link criado (aparece só agora):</div><input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Link do contrato" />
      <div className="row"><button className="btn small" onClick={copyLink}>Copiar link</button><a className="btn small" href={`https://wa.me/?text=${encodeURIComponent(msg(link))}`} target="_blank" rel="noreferrer">WhatsApp</a><a className="btn small" href={`mailto:?subject=${encodeURIComponent(d.title)}&body=${encodeURIComponent(msg(link))}`}>E-mail</a></div></div>}
    {d.shares.length > 0 && <div className="list">{d.shares.map((s: any) => { const ativo = !s.revoked_at && new Date(s.expires_at) > new Date(); return (
      <div className="item" key={s.id}><div style={{ flex: 1 }}><span className={`chip ${ativo ? 'ok' : 'gray'}`}>{s.revoked_at ? 'Cancelado' : ativo ? 'Ativo' : 'Expirado'}</span> criado em {dateTimeBR(s.created_at)} · expira {dateTimeBR(s.expires_at)} · {s.views} visualização(ões)</div>
        {ativo && <button className="btn small danger" onClick={async () => { try { await del(`/api/contract-docs/${d.id}/shares/${s.id}`); onChange(); } catch (e) { setErr(errMsg(e)); } }}>Cancelar link</button>}</div>); })}</div>}
    <hr />
    <h3>Copiar para outro cliente</h3>
    <div className="row"><select aria-label="Cliente" value={target} onChange={(e) => setTarget(e.target.value)} style={{ flex: 1 }}><option value="">— escolha o cliente —</option>{(people.data?.items ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.display_name || p.name}</option>)}</select>
      <button className="btn" disabled={!target} onClick={async () => { try { await post(`/api/contract-docs/${d.id}/copy`, { person_id: target }); onCopied('Cópia criada na pasta do outro cliente (rascunho)'); setTarget(''); } catch (e) { setErr(errMsg(e)); } }}>Copiar</button></div>
    <p className="small muted">Os dados da pessoa no texto não mudam sozinhos: na cópia, ajuste a aba “Campos” e use “Atualizar texto”.</p>
  </div>);
}
