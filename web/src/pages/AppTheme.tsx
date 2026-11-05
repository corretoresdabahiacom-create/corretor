import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, get, patch, upload } from '../api';
import { useSession } from '../session';
import { Async, Field, useAsync, useToast } from '../ui';
import { Icon } from '../icons';
import { applyTheme, type AppTheme } from '../theme';
import { Acc, Color, Library, Options, PRESETS } from './SiteEditor';

/** Aparência do app da equipe: as mesmas opções do site, aplicadas ao vivo no próprio app enquanto você edita. */
export default function AppThemePage() {
  const st = useAsync(async () => {
    const [t, site, brand] = await Promise.all([get('/api/app-theme'), get('/api/site'), get('/api/brand')]);
    return { ...t, site, brand };
  }, []);
  return <Async state={st}>{(d) => <Editor data={d} />}</Async>;
}

function Editor({ data }: { data: any }) {
  const { session, refresh } = useSession(); const toast = useToast();
  const [t, setT] = useState<AppTheme>(data.theme); const [saved, setSaved] = useState(JSON.stringify(data.theme));
  const [images, setImages] = useState<any[]>(data.site.images); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const dirty = JSON.stringify(t) !== saved;
  const fromSite = useMemo(() => ({ primary: data.brand.brand.primary, accent: data.brand.brand.secondary, bg: data.site.site.theme.bg, text: data.site.site.theme.text, font: data.site.site.theme.font, radius: data.site.site.theme.radius, nav: data.site.site.theme.header, cards: data.site.site.theme.cards }), [data]);
  const shown: AppTheme = t.source === 'site' ? { ...t, ...fromSite } : t;
  const bannerId = shown.banner_image || (t.source === 'site' ? data.site.site.hero.images[0] ?? '' : '');
  // Pré-visualização ao vivo: o app inteiro muda enquanto você edita. Ao sair sem salvar, volta ao tema salvo.
  useEffect(() => { applyTheme({ ...shown, banner_url: bannerId ? `/api/public/site/${session!.org.slug}/img/${bannerId}?w=1600` : null }); }, [JSON.stringify(shown), bannerId]);
  const live = useRef(session?.theme); live.current = session?.theme;
  useEffect(() => () => applyTheme(live.current), []); // ao sair da tela, volta ao tema salvo
  useEffect(() => { const h = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h); }, [dirty]);
  const set = <K extends keyof AppTheme>(k: K, v: AppTheme[K]) => setT((x) => ({ ...x, [k]: v, ...(k !== 'source' && k !== 'banner' && k !== 'banner_image' && x.source === 'site' ? { ...fromSite, [k]: v, source: 'proprio' } : {}) }));
  const save = async () => {
    setBusy(true); setErr('');
    try { const r = await patch('/api/app-theme', t); setT(r.theme); setSaved(JSON.stringify(r.theme)); await refresh(); toast('Aparência do app salva para toda a equipe'); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível salvar.'); } finally { setBusy(false); }
  };
  const send = async (files: FileList) => { for (const f of Array.from(files)) { try { const r = await upload('/api/site/images', f); set('banner_image', r.id); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha no envio.'); } } setImages((await get('/api/site')).images); };

  return (
    <>
      <div className="page-head"><h1>Aparência do app</h1><span className="small muted">Vale para toda a equipe, no computador e no celular.</span></div>
      <div className="editor">
        <div>
          <Acc icon="store" title="Ponto de partida" hint="Use o mesmo visual do site ou monte um próprio" open>
            <Options value={t.source} onChange={(v) => setT((x) => (v === 'site' ? { ...x, source: 'site' } : { ...x, ...fromSite, source: 'proprio' }))} options={[['site', 'Igual ao site', 'Cores, letras e cantos do site da vitrine'], ['proprio', 'Visual próprio', 'Escolha tudo abaixo']]} />
            {t.source === 'site' && <p className="small muted">Mudou o site? O app acompanha automaticamente. Mexer em qualquer opção abaixo troca para “Visual próprio”.</p>}
          </Acc>
          <Acc icon="palette" title="Cores" hint="Marca, destaque, fundo e texto" open>
            <Field label="Sugestões de fundo"><div className="swatches">{PRESETS.map(([n, bg, tx]) => <button key={n} type="button" className="swatch" title={n} aria-label={`Usar fundo ${n}`} style={{ background: `linear-gradient(135deg, ${bg} 50%, ${tx} 50%)` }} onClick={() => setT((x) => ({ ...(x.source === 'site' ? { ...x, ...fromSite } : x), source: 'proprio', bg, text: tx }))} />)}</div></Field>
            <div className="grid g2">
              <Color label="Cor principal (botões, menu ativo)" value={shown.primary} onChange={(v) => set('primary', v)} />
              <Color label="Cor de destaque (selos, botão da capa)" value={shown.accent} onChange={(v) => set('accent', v)} />
              <Color label="Fundo" value={shown.bg} onChange={(v) => set('bg', v)} />
              <Color label="Texto" value={shown.text} onChange={(v) => set('text', v)} />
            </div>
          </Acc>
          <Acc icon="layout" title="Estilo" hint="Menu, letras, cantos e lista de imóveis" open>
            <Field label="Menu lateral (computador)"><Options value={shown.nav} onChange={(v) => set('nav', v as AppTheme['nav'])} options={[['claro', 'Claro', 'Fundo branco'], ['escuro', 'Escuro', 'Fundo grafite'], ['cor', 'Na cor principal', 'Menu colorido']]} /></Field>
            <Field label="Imóveis aparecem em"><Options value={shown.cards} onChange={(v) => set('cards', v as AppTheme['cards'])} options={[['grade', 'Grade', 'Cartões com foto'], ['lista', 'Lista', 'Foto ao lado']]} /></Field>
            <div className="grid g2">
              <Field label="Letras dos títulos"><Options value={shown.font} onChange={(v) => set('font', v as AppTheme['font'])} options={[['moderna', 'Moderna', 'Sem serifa'], ['classica', 'Clássica', 'Com serifa'], ['elegante', 'Elegante', 'Serifa refinada']]} /></Field>
              <Field label="Cantos"><Options value={shown.radius} onChange={(v) => set('radius', v as AppTheme['radius'])} options={[['reto', 'Retos', ''], ['suave', 'Suaves', ''], ['redondo', 'Arredondados', '']]} /></Field>
            </div>
          </Acc>
          <Acc icon="image" title="Capa do Início" hint="Foto e busca rápida no topo da tela inicial">
            <label className="row"><input type="checkbox" checked={t.banner} onChange={(e) => set('banner', e.target.checked)} /> Mostrar foto na capa (sem foto, usa a cor principal)</label>
            <Library label="Foto da capa" max={1} images={images} selected={t.banner_image ? [t.banner_image] : []} onPick={(id) => set('banner_image', t.banner_image === id ? '' : id)} onUpload={send} />
            {!t.banner_image && t.source === 'site' && <p className="small muted">Sem foto escolhida: usa a primeira foto da capa do site.</p>}
            <p className="small muted">As fotos são as mesmas do site (Site e cartão → Site). Excluir uma foto lá também a tira daqui.</p>
          </Acc>
          {err && <div className="alert err" role="alert">{err}</div>}
          <div className={`savebar ${dirty ? 'dirty' : ''}`}><span className="small muted">{dirty ? 'Pré-visualizando — ainda não salvo' : 'Tudo salvo'}</span><button className="btn" disabled={!dirty || busy} onClick={() => setT(JSON.parse(saved))}>Desfazer</button><button className="btn primary" disabled={!dirty || busy} onClick={save}>{busy ? 'Salvando…' : 'Salvar para a equipe'}</button></div>
        </div>
        <div className="preview stack" style={{ padding: '1rem' }}>
          <div className="row"><b>Amostra</b><span className="small muted">O app inteiro já está mostrando suas escolhas.</span></div>
          <section className={`dash-hero ${shown.banner && bannerId ? 'has-img' : ''}`} style={{ marginBottom: 0 }}>{shown.banner && bannerId && <img src={`/api/public/site/${session!.org.slug}/img/${bannerId}?w=1000`} alt="" />}<div className="in"><h1 style={{ fontSize: '1.5rem' }}>Boa tarde, {session!.user.name.split(' ')[0]}</h1><p>Capa do Início</p><div className="acts"><span className="btn primary">+ Pessoa</span><span className="btn">+ Imóvel</span></div></div></section>
          <div className={`plist ${shown.cards}`}><div className="pgrid" style={{ gridTemplateColumns: shown.cards === 'lista' ? '1fr' : 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))' }}>
            {[['Casa com quintal', 'R$ 680.000', 'Campinas/SP'], ['Chácara com pomar', 'R$ 950.000', 'Atibaia/SP']].map(([a, b, c]) => <article key={a} className="pcard"><div className="ph"><span className="ni"><Icon name="image" size={26} />Foto</span><span className="bdg"><span className="f">Destaque</span><span>Venda</span></span></div><div className="bd"><div className="pr">{b}</div><h3>{a}</h3><div className="loc">Casa · {c}</div><div className="fx"><span><Icon name="bed" size={16} />3 qts</span><span><Icon name="area" size={16} />180 m²</span></div></div></article>)}
          </div></div>
          <div className="card" style={{ marginBottom: 0 }}><h2>Cartão de exemplo</h2><p className="muted small">Texto secundário e <a href="#!" onClick={(e) => e.preventDefault()}>um link</a>.</p><div className="chips"><span className="chip">Disponível</span><span className="chip ok">Fechado</span><span className="chip warn">Litoral</span></div><div className="row" style={{ marginTop: '.6rem' }}><button className="btn primary">Botão principal</button><button className="btn">Secundário</button></div></div>
        </div>
      </div>
    </>
  );
}
