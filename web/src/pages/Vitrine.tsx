import { useEffect, useRef, useState } from 'react';
import { Icon } from '../icons';
import SiteEditor from './SiteEditor';
import { ApiError, get, patch, upload, del } from '../api';
import { useSession } from '../session';
import { Async, Field, useAsync, useToast } from '../ui';

const LAYOUTS: [string, string][] = [['classico', 'Clássico'], ['moderno', 'Moderno'], ['minimal', 'Minimalista']];

function BrandForm({ data, reload }: { data: any; reload: () => void }) {
  const toast = useToast(); const file = useRef<HTMLInputElement>(null);
  const [b, setB] = useState({ ...data.brand }); const [svcs, setSvcs] = useState<string>((data.brand.services ?? []).join('\n')); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setB((s: any) => ({ ...s, [k]: v }));
  const save = async () => { setBusy(true); setErr(''); try { await patch('/api/brand', { primary: b.primary, secondary: b.secondary, tagline: b.tagline, title: b.title, intro: b.intro, layout: b.layout, card_layout: b.card_layout, services: svcs.split('\n').map((x: string) => x.trim()).filter(Boolean) }); toast('Marca salva'); reload(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Erro'); } finally { setBusy(false); } };
  const send = async (f?: File) => { if (!f) return; setErr(''); try { await upload('/api/brand/logo', f); toast('Logomarca atualizada'); reload(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Erro'); } if (file.current) file.current.value = ''; };
  return (
    <section className="card stack"><h2>Identidade da imobiliária</h2><p className="small muted">Logomarca, cores e serviços valem para o site, a página de cada imóvel e o cartão de visita.</p>
      <div className="row">{data.has_logo ? <img src={`${data.logo_url}?t=${Date.now()}`} alt="Logomarca" style={{ height: 64, background: '#fff', border: '1px solid var(--line)', borderRadius: 8, padding: 4 }} /> : <span className="muted small">Sem logomarca</span>}
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => send(e.target.files?.[0])} />
        <button className="btn small" onClick={() => file.current?.click()}>{data.has_logo ? 'Trocar logomarca' : 'Enviar logomarca'}</button>
        {data.has_logo && <button className="btn small danger" onClick={async () => { await del('/api/brand/logo'); reload(); }}>Remover</button>}</div>
      <p className="small muted">PNG, JPG ou WebP até 2 MB. Fundo transparente (PNG) fica melhor.</p>
      <div className="grid g2">
        <Field label="Cor principal"><input type="color" value={b.primary} onChange={(e) => set('primary', e.target.value)} style={{ height: 44 }} /></Field>
        <Field label="Cor de destaque"><input type="color" value={b.secondary} onChange={(e) => set('secondary', e.target.value)} style={{ height: 44 }} /></Field>
      </div>
      <Field label="Nome exibido no site" hint="Se vazio, usa o nome da imobiliária."><input maxLength={80} value={b.title} onChange={(e) => set('title', e.target.value)} /></Field>
      <Field label="Slogan"><input maxLength={80} value={b.tagline} onChange={(e) => set('tagline', e.target.value)} placeholder="Ex.: Seu lar, nossa missão" /></Field>
      <Field label="Texto curto de apresentação" hint="Usado na prévia do link (WhatsApp, Google)."><textarea maxLength={400} value={b.intro} onChange={(e) => set('intro', e.target.value)} /></Field>
      <Field label="Categorias de serviço (uma por linha, até 5)" hint="Aparecem em coluna no cartão e na vitrine. Ex.: Avaliação de imóveis."><textarea rows={5} value={svcs} onChange={(e) => setSvcs(e.target.value)} /></Field>
      {err && <div className="alert err" role="alert">{err}</div>}
      <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Salvando…' : 'Salvar marca'}</button>
    </section>
  );
}

function MyCard({ data, reload }: { data: any; reload: () => void }) {
  const { can } = useSession(); const toast = useToast(); const prof = useAsync(() => get('/api/card/profile'), []);
  const [layout, setLayout] = useState<string>(data.brand.card_layout); const [v, setV] = useState(0); const [headline, setHeadline] = useState<string | null>(null);
  const [f, setF] = useState<any>(null); const [err, setErr] = useState('');
  const [cc, setCc] = useState<any>({ ...data.brand.card }); const [ct, setCt] = useState<string>((data.brand.card?.contacts ?? []).join('\n'));
  const setC = (k: string, val: string) => setCc((x: any) => ({ ...x, [k]: val }));
  const saveCard = async () => { setErr(''); try { await patch('/api/brand', { card: { ...cc, contacts: ct.split('\n').map((x) => x.trim()).filter(Boolean) } }); toast('Cartão personalizado salvo'); setV((x) => x + 1); reload(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Erro'); } };
  const colorField = (k: string, label: string, fallback: string) => <Field label={label}><div className="row"><input type="color" value={cc[k] || fallback} onChange={(e) => setC(k, e.target.value)} style={{ height: 44, flex: 1 }} /><button className="btn small" onClick={() => setC(k, '')} disabled={!cc[k]}>Padrão</button></div></Field>;
  const cur = f ?? prof.data;
  const set = (k: string, val: string) => setF({ ...(f ?? prof.data), [k]: val });
  const save = async () => { setErr(''); try { await patch('/api/card/profile', { title: cur.title, phone: cur.phone, whatsapp: cur.whatsapp, creci: cur.creci, card_email: cur.card_email ?? '', headline: headline ?? cur.headline }); toast('Dados do cartão salvos'); setV((x) => x + 1); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Erro'); } };
  const hl = headline ?? cur?.headline ?? 'imobiliaria';
  const url = (side: string, ext: string) => `/api/card/${side}.${ext}?layout=${layout}&headline=${hl}&v=${v}`;
  const print = () => {
    const w = window.open('', '_blank'); if (!w) { toast('Permita pop-ups para imprimir'); return; }
    w.document.write(`<!doctype html><title>Cartão de visita</title><style>@page{size:90mm 50mm;margin:0}body{margin:0}img{display:block;width:90mm;height:50mm}@media screen{body{background:#ddd;padding:10mm}img{margin-bottom:6mm;box-shadow:0 2px 8px #0004}}</style><img src="${url('front', 'png')}"><script>window.onload=function(){setTimeout(function(){print()},400)}<\/script>`);
    w.document.close();
  };
  return (
    <section className="card stack"><h2>Meu cartão de visita</h2>
      <Async state={prof}>{() => (
        <>
          <div className="grid g2">
            <Field label="Cargo"><input value={cur.title ?? ''} onChange={(e) => set('title', e.target.value)} placeholder="Corretor de imóveis" /></Field>
            <Field label="CRECI (opcional)"><input value={cur.creci ?? ''} onChange={(e) => set('creci', e.target.value)} /></Field>
            <Field label="Telefone"><input inputMode="tel" value={cur.phone ?? ''} onChange={(e) => set('phone', e.target.value)} placeholder="(11) 98888-7777" /></Field>
            <Field label="WhatsApp"><input inputMode="tel" value={cur.whatsapp ?? ''} onChange={(e) => set('whatsapp', e.target.value)} /></Field>
          </div>
          <Field label="E-mail no cartão" hint={`Se vazio, usa ${cur.email}.`}><input type="email" value={cur.card_email ?? ''} onChange={(e) => set('card_email', e.target.value)} /></Field>
          {err && <div className="alert err" role="alert">{err}</div>}
          <button className="btn" onClick={save}>Salvar dados</button>
          <div className="chips">{LAYOUTS.map(([k, l]) => <button key={k} className={`btn small ${layout === k ? 'primary' : ''}`} onClick={() => setLayout(k)}>{l}</button>)}</div>
          <div className="chips"><span className="small muted" style={{ alignSelf: 'center' }}>Nome em destaque:</span><button className={`btn small ${hl === 'imobiliaria' ? 'primary' : ''}`} onClick={() => setHeadline('imobiliaria')}>Imobiliária</button><button className={`btn small ${hl === 'corretor' ? 'primary' : ''}`} onClick={() => setHeadline('corretor')}>Corretor</button></div>
          <div className="cardprev"><figure><a href={data.vitrine_url} target="_blank" rel="noreferrer" title="Abrir a vitrine"><img src={url('front', 'png')} alt="Frente do cartão de visita (clique para abrir a vitrine)" /></a></figure></div>
          {can('org.manage') && <details className="stack"><summary><b>Personalizar o cartão (cores e textos)</b></summary>
            <p className="small muted">Vale para o cartão de toda a equipe. Deixe em branco ou toque em “Padrão” para voltar ao automático.</p>
            <div className="grid g2">{colorField('bg', 'Cor de fundo', '#ffffff')}{colorField('fg', 'Cor do texto', '#111827')}{colorField('accent', 'Cor do botão e destaques', data.brand.secondary)}</div>
            <Field label="Nome em destaque (texto livre)" hint="Em branco: nome da imobiliária ou do corretor."><input maxLength={40} value={cc.headline_text ?? ''} onChange={(e) => setC('headline_text', e.target.value)} /></Field>
            <Field label="Linha abaixo do nome" hint="Em branco: nome e cargo."><input maxLength={60} value={cc.sub_text ?? ''} onChange={(e) => setC('sub_text', e.target.value)} /></Field>
            <Field label="Título da coluna de serviços"><input maxLength={22} value={cc.services_title ?? ''} onChange={(e) => setC('services_title', e.target.value)} placeholder="Nossos serviços" /></Field>
            <Field label="Texto do botão"><input maxLength={18} value={cc.button_label ?? ''} onChange={(e) => setC('button_label', e.target.value)} placeholder="Clique aqui" /></Field>
            <Field label="Contatos (uma linha cada, até 4)" hint="Em branco: telefone, WhatsApp, e-mail e CRECI de cada usuário."><textarea rows={4} value={ct} onChange={(e) => setCt(e.target.value)} /></Field>
            <p className="small muted">Serviços: edite em “Marca da imobiliária”.</p>
            <button className="btn primary" onClick={saveCard}>Salvar personalização</button>
          </details>}
          <div className="row"><button className="btn primary" onClick={print}>🖨 Imprimir / salvar PDF</button><a className="btn" href={url('front', 'png')} download="cartao-de-visita.png">Baixar PNG</a></div>
          <p className="small muted">Tamanho 90 × 50 mm, 300 dpi, pronto para gráfica. As categorias de serviço vêm da marca (acima) e o botão “Clique aqui” e o QR Code abrem a vitrine, contando o acesso como “cartão”.</p>
        </>
      )}</Async>
    </section>
  );
}

const TABS: [string, string, string][] = [['site', 'Site', 'store'], ['marca', 'Identidade', 'palette'], ['cartao', 'Cartão', 'card'], ['divulgar', 'Divulgar', 'share']];

export default function Vitrine() {
  const { can } = useSession(); const toast = useToast();
  const admin = can('org.manage');
  const [tab, setTab] = useState<string>(() => { const h = location.hash.slice(1); return TABS.some(([k]) => k === h) ? h : admin ? 'site' : 'cartao'; });
  useEffect(() => { history.replaceState(null, '', '#' + tab); }, [tab]);
  const st = useAsync(() => get('/api/brand'), []);
  const g = useAsync(() => get('/api/growth').catch(() => null), []);
  const tabs = TABS.filter(([k]) => admin || k === 'cartao' || k === 'divulgar');
  return (
    <>
      <div className="page-head"><h1>Site e cartão</h1><Async state={st}>{(d) => <a className="btn small right" href={d.vitrine_url} target="_blank" rel="noreferrer"><Icon name="eye" size={16} />Ver site</a>}</Async></div>
      <div className="tabs" role="tablist">{tabs.map(([k, l, ic]) => <button key={k} role="tab" aria-selected={tab === k} className={`btn small ${tab === k ? 'primary' : ''}`} onClick={() => setTab(k)}><Icon name={ic} size={17} />{l}</button>)}</div>
      {tab === 'site' && admin && <SiteEditor />}
      <Async state={st}>{(d) => (
        <>
          {tab === 'marca' && admin && <BrandForm data={d} reload={st.reload} />}
          {tab === 'cartao' && <MyCard data={d} reload={st.reload} />}
          {tab === 'divulgar' && (
            <section className="card stack"><h2>Divulgue seu site</h2>
              <p className="small muted">Site com seus imóveis publicados e disponíveis, com busca, filtros, fotos, vídeos e descrições. Quem recebe o link ou lê o QR Code vê somente o site — nunca o sistema.</p>
              <input readOnly value={d.vitrine_url} onFocus={(e) => e.target.select()} aria-label="Link do site" />
              <div className="row"><a className="btn primary" href={d.vitrine_url} target="_blank" rel="noreferrer">Abrir site</a><button className="btn" onClick={() => { navigator.clipboard?.writeText(d.vitrine_url); toast('Link copiado'); }}>Copiar link</button>
                <a className="btn" href={`https://wa.me/?text=${encodeURIComponent('Confira nossos imóveis: ' + d.vitrine_url)}`} target="_blank" rel="noreferrer">Enviar por WhatsApp</a>
                {typeof navigator !== 'undefined' && 'share' in navigator && <button className="btn" onClick={() => (navigator as any).share({ title: d.name, url: d.vitrine_url }).catch(() => {})}><Icon name="share" size={17} />Compartilhar</button>}</div>
              <div className="row"><div className="qr-box"><img src={d.vitrine_qr_url} alt="QR Code do site" width={150} height={150} /></div><div className="stack"><a className="btn small" href={d.vitrine_qr_url} download="qrcode-site.svg"><Icon name="download" size={16} />Baixar QR Code</a><span className="small muted">{d.listed} imóvel(is) no site</span></div></div>
              {d.listed === 0 && <div className="alert warn small">Nenhum imóvel no site ainda. Em cada imóvel disponível, use “Publicar página”.</div>}
              <Async state={g}>{(gr) => gr ? <div className="small muted">Acessos nos últimos 30 dias: {gr.vitrine_last_30_days.link} por link · {gr.vitrine_last_30_days.qr} por QR Code · {gr.vitrine_last_30_days.cartao} pelo cartão</div> : null}</Async>
            </section>
          )}
        </>
      )}</Async>
    </>
  );
}
