import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, get, patch, post } from '../api';
import { useSession } from '../session';
import { Async, Empty, Field, useAsync, useConfirm, useToast } from '../ui';
import { dateBR, maskPhone as phoneBR } from '../format';

/** Cartão de divulgação na tela do imóvel: publicar, copiar link, compartilhar e ver números. */
export function PortalCard({ propertyId, canWrite }: { propertyId: string; canWrite: boolean }) {
  const st = useAsync(() => get(`/api/properties/${propertyId}/portal`), [propertyId]);
  const toast = useToast(); const [err, setErr] = useState('');
  const run = async (fn: () => Promise<any>) => { setErr(''); try { await fn(); st.reload(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Erro'); } };
  const share = async (channel: string) => {
    try { const r = await post(`/api/properties/${propertyId}/share`, { channel }); if (channel === 'whatsapp') window.open(r.whatsapp_url, '_blank', 'noopener'); else { await navigator.clipboard?.writeText(r.url); toast('Link copiado'); } st.reload(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Erro'); }
  };
  return (
    <Async state={st}>{(d) => (
      <section className="card stack">
        <h2>Divulgação</h2>
        {err && <div className="alert err" role="alert">{err}</div>}
        {!d.published ? (
          <>
            <p className="small muted">Gera uma página pública com fotos marcadas como públicas e formulário de contato. Dados internos, documentos e proprietário nunca aparecem.</p>
            {!d.authorized && <div className="alert warn small">Marque “o proprietário autorizou a divulgação” ao editar o imóvel.</div>}
            {canWrite && <button className="btn primary" onClick={() => run(() => post(`/api/properties/${propertyId}/publish`))}>Publicar página</button>}
          </>
        ) : (
          <>
            <div className="small"><a href={d.url} target="_blank" rel="noreferrer">{d.url}</a></div>
            {d.public_photos === 0 && <div className="alert warn small">Nenhuma foto pública ainda. Marque fotos como “públicas” na galeria.</div>}
            <div className="row"><button className="btn small primary" onClick={() => share('whatsapp')}>Enviar por WhatsApp</button><button className="btn small" onClick={() => share('link')}>Copiar link</button>{canWrite && <button className="btn small danger right" onClick={() => run(() => post(`/api/properties/${propertyId}/unpublish`))}>Despublicar</button>}</div>
            {canWrite && <label className="row small"><input type="checkbox" checked={d.featured} onChange={(e) => run(() => patch(`/api/properties/${propertyId}/feature`, { featured: e.target.checked }))} /> Destacar na vitrine</label>}
            <div className="small"><Link to="/vitrine">Ver vitrine e cartão →</Link></div>
            <div className="small muted">Últimos 30 dias: {d.last_30_days.views} visualizações · {d.last_30_days.shares} compartilhamentos · {d.last_30_days.leads} contatos</div>
          </>
        )}
      </section>
    )}</Async>
  );
}

function Leads() {
  const st = useAsync(() => get('/api/leads?status=novo'), []);
  const { can } = useSession(); const toast = useToast(); const { ask, node } = useConfirm();
  return (
    <section className="card stack"><h2>Contatos novos do portal</h2>
      <Async state={st}>{(rows: any[]) => !rows.length ? <Empty>Nenhum contato novo. Publique imóveis e compartilhe o link para receber interessados.</Empty> : <div className="list">{rows.map((l) => (
        <div className="item" key={l.id} style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}><b>{l.name}</b> <span className="small muted">{dateBR(l.created_at)}</span>
            <div className="small">{[l.phone && phoneBR(l.phone), l.email].filter(Boolean).join(' · ')}</div>
            {l.kind === 'avaliacao' ? <div className="small"><span className="chip warn">Pedido de avaliação</span> {l.details?.property_type} · {l.details?.address}</div> : <div className="small muted">Imóvel: <Link to={`/imoveis/${l.property_id}`}>{l.property_code} · {l.property_title}</Link></div>}
            {l.details?.visit?.date && <div className="small"><span className="chip warn">Pediu visita</span> {dateBR(l.details.visit.date)}{l.details.visit.period ? ' · ' + ({ manha: 'manhã', tarde: 'tarde', noite: 'noite' } as any)[l.details.visit.period] : ''}</div>}
            {l.message && <div className="small">“{l.message}”</div>}</div>
          {can('people.write') && <div className="stack">
            <button className="btn small primary" onClick={async () => { try { const r = await post(`/api/leads/${l.id}/convert`); toast(r.existing ? 'Vinculado a cadastro existente' : 'Pessoa criada'); st.reload(); } catch (e) { toast(e instanceof ApiError ? e.message : 'Erro'); } }}>Virar cliente</button>
            <button className="btn small" onClick={async () => { if (await ask('Descartar este contato?', 'Descartar')) { await post(`/api/leads/${l.id}/discard`); st.reload(); } }}>Descartar</button></div>}
        </div>))}</div>}</Async>
      {node}
    </section>
  );
}

function PlanAndProfile() {
  const st = useAsync(() => get('/api/org/plan'), []);
  const { can } = useSession(); const toast = useToast();
  const [name, setName] = useState<string | null>(null); const [wa, setWa] = useState<string | null>(null); const [err, setErr] = useState('');
  return (
    <Async state={st}>{(d) => (
      <>
        <section className="card stack"><h2>Plano {d.plan}</h2>
          {(['properties', 'published', 'users'] as const).map((k) => <div key={k} className="small">{{ properties: 'Imóveis', published: 'Páginas publicadas', users: 'Usuários e convites' }[k]}: <b>{d.used[k]}</b> de {d.limits[k] >= 1e9 ? 'ilimitado' : d.limits[k]}</div>)}
          <p className="small muted">O plano gratuito mantém o selo “Feito com ImobFlow” nas páginas públicas. Ainda não há plano pago nem cobrança.</p>
        </section>
        <section className="card stack"><h2>Convide outra imobiliária</h2>
          <p className="small muted">Link de indicação (aparece também no selo das suas páginas):</p>
          <input readOnly value={d.referral_link} onFocus={(e) => e.target.select()} />
          <button className="btn small" onClick={() => { navigator.clipboard?.writeText(d.referral_link); toast('Link copiado'); }}>Copiar</button>
        </section>
        <section className="card stack"><h2>Perfil nas páginas públicas</h2>
          <Field label="Nome exibido"><input disabled={!can('org.manage')} value={name ?? d.profile.public_name ?? ''} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="WhatsApp (DDD + número)" hint="Se vazio, não aparece botão de WhatsApp."><input disabled={!can('org.manage')} inputMode="tel" value={wa ?? d.profile.public_whatsapp ?? ''} onChange={(e) => setWa(e.target.value)} /></Field>
          {err && <div className="alert err">{err}</div>}
          {can('org.manage') && <button className="btn" onClick={async () => { setErr(''); try { await patch('/api/org/public-profile', { public_name: name ?? undefined, public_whatsapp: wa ?? undefined }); toast('Perfil salvo'); st.reload(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Erro'); } }}>Salvar</button>}
        </section>
      </>
    )}</Async>
  );
}

export default function Portal() {
  const g = useAsync(() => get('/api/growth'), []);
  const { can } = useSession();
  return (
    <>
      <h1>Portal e crescimento</h1>
      {can('reports.read') && <Async state={g}>{(d) => (
        <section className="card stack"><h2>Últimos 30 dias</h2>
          <div className="grid g2">
            <div>👁 <b>{d.last_30_days.views}</b> visualizações</div><div>🔗 <b>{d.last_30_days.shares}</b> compartilhamentos</div>
            <div>✉️ <b>{d.last_30_days.leads}</b> contatos ({d.last_30_days.leads_converted} viraram clientes)</div><div>🤝 <b>{d.referred_agencies}</b> imobiliárias indicadas</div>
          </div>
          {d.properties.length > 0 && <div className="scroll-x"><table className="rtable"><thead><tr><th>Imóvel</th><th>Visualizações</th><th>Compartilhamentos</th><th>Contatos</th></tr></thead><tbody>{d.properties.map((p: any) => <tr key={p.id}><td><Link to={`/imoveis/${p.id}`}>{p.code} · {p.title}</Link></td><td data-label="Visualizações">{p.views}</td><td data-label="Compartilhamentos">{p.shares}</td><td data-label="Contatos">{p.leads}</td></tr>)}</tbody></table></div>}
          <p className="small muted">{d.note}</p>
        </section>
      )}</Async>}
      <Leads />
      <PlanAndProfile />
    </>
  );
}
