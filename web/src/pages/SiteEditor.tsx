import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, del, get, patch, upload } from '../api';
import { Async, Field, useAsync, useConfirm, useToast } from '../ui';
import { Icon } from '../icons';

const SECTION_LABEL: Record<string, string> = { destaques: 'Destaques', imoveis: 'Imóveis com filtros', servicos: 'Serviços', sobre: 'Sobre nós', videos: 'Vídeos', galeria: 'Galeria de fotos', avaliacao: 'Avaliação de imóveis', contato: 'Contato' };
export const PRESETS: [string, string, string][] = [['Claro', '#f6f7f9', '#1f2937'], ['Branco', '#ffffff', '#111827'], ['Areia', '#f7f2ea', '#2b2118'], ['Verde-água', '#eef7f5', '#12302c'], ['Escuro', '#0f141a', '#eef2f6'], ['Azul-noite', '#0b1426', '#e8eefb']];
const HEX = /^#[0-9a-fA-F]{6}$/;

type Opt = [string, string, string];
export function Options({ value, options, onChange }: { value: string; options: Opt[]; onChange: (v: string) => void }) {
  return <div className="optgrid">{options.map(([k, l, d]) => <button type="button" key={k} className={`opt ${value === k ? 'on' : ''}`} aria-pressed={value === k} onClick={() => onChange(k)}><b>{l}</b><small>{d}</small></button>)}</div>;
}
export function Color({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [t, setT] = useState(value); useEffect(() => setT(value), [value]);
  return <Field label={label}><div className="colorrow"><input type="color" value={HEX.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} aria-label={label} /><input type="text" value={t} maxLength={7} onChange={(e) => { setT(e.target.value); if (HEX.test(e.target.value)) onChange(e.target.value); }} /></div></Field>;
}
export const Acc = ({ icon, title, hint, open, children }: { icon: string; title: string; hint?: string; open?: boolean; children: React.ReactNode }) => (
  <details className="acc" open={open}><summary><Icon name={icon} /><span>{title}{hint && <><br /><small>{hint}</small></>}</span></summary><div className="acc-body stack">{children}</div></details>
);

/** Biblioteca de fotos do site: enviar, excluir, escolher. */
export function Library({ images, selected, onPick, onUpload, onDelete, max, label }: { images: any[]; selected: string[]; onPick: (id: string) => void; onUpload: (f: FileList) => void; onDelete?: (id: string) => void; max?: number; label: string }) {
  const ref = useRef<HTMLInputElement>(null); const [over, setOver] = useState(false);
  return (
    <div className="stack">
      <div className={`drop ${over ? 'over' : ''}`} role="button" tabIndex={0} onClick={() => ref.current?.click()} onKeyDown={(e) => e.key === 'Enter' && ref.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) onUpload(e.dataTransfer.files); }}>
        <Icon name="image" size={26} className="" /><div><b>Enviar fotos</b> — toque aqui ou arraste</div><small>JPG, PNG ou WebP até 10 MB. A localização (GPS) da foto é removida.</small>
        <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { if (e.target.files?.length) onUpload(e.target.files); e.target.value = ''; }} />
      </div>
      {images.length > 0 && <><div className="small muted">{label}{max ? ` (até ${max})` : ''}. Toque na foto para escolher.</div>
        <div className="thumbs">{images.map((i) => { const n = selected.indexOf(i.id); return (
          <figure key={i.id} className={n >= 0 ? 'on' : ''}><button type="button" style={{ all: 'unset', cursor: 'pointer', display: 'block' }} onClick={() => onPick(i.id)} aria-pressed={n >= 0} aria-label={n >= 0 ? 'Remover da seleção' : 'Escolher foto'}><img src={i.url} alt="" loading="lazy" /></button>
            {n >= 0 && <span className="tag">{max === 1 ? 'Escolhida' : n + 1}</span>}
            {onDelete && <button type="button" className="tbtn" aria-label="Excluir foto" onClick={() => onDelete(i.id)}><Icon name="trash" size={15} /></button>}
          </figure>); })}</div></>}
    </div>
  );
}

/** Pré-visualização: celular em tamanho real; computador em 1280 px reduzido para caber. */
function Frame({ device, html }: { device: 'phone' | 'desk'; html: string }) {
  const box = useRef<HTMLDivElement>(null); const [w, setW] = useState(600);
  useEffect(() => { const el = box.current; if (!el) return; const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); return () => ro.disconnect(); }, []);
  const H = Math.min(window.innerHeight * 0.78, 900);
  if (device === 'phone') return <div ref={box}><iframe title="Pré-visualização do site (celular)" className="preview-frame phone" srcDoc={html} /></div>;
  const sc = Math.min(1, w / 1280);
  return <div ref={box} style={{ height: H, overflow: 'hidden' }}><iframe title="Pré-visualização do site (computador)" srcDoc={html} style={{ width: 1280, height: H / sc, border: 0, transform: `scale(${sc})`, transformOrigin: '0 0', background: '#fff' }} /></div>;
}

export default function SiteEditor() {
  const st = useAsync(() => get('/api/site'), []);
  return <Async state={st}>{(d) => <Editor key={d.preview_url} data={d} reload={st.reload} />}</Async>;
}

function Editor({ data, reload }: { data: any; reload: () => void }) {
  const toast = useToast(); const { ask, node } = useConfirm();
  const [s, setS] = useState<any>(data.site); const [saved, setSaved] = useState<string>(JSON.stringify(data.site));
  const [images, setImages] = useState<any[]>(data.images);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [ver, setVer] = useState(0); const [device, setDevice] = useState<'phone' | 'desk'>('phone');
  const [vidUrl, setVidUrl] = useState(''); const [vidTitle, setVidTitle] = useState('');
  const dirty = useMemo(() => JSON.stringify(s) !== saved, [s, saved]);
  useEffect(() => { const h = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h); }, [dirty]);
  const set = (block: string, k: string, v: any) => setS((x: any) => ({ ...x, [block]: { ...x[block], [k]: v } }));
  const draftBody = (x: any) => ({ theme: x.theme, hero: x.hero, about: x.about, contact: x.contact, videos: x.videos.map((v: any) => ({ url: v.url ?? (v.provider === 'youtube' ? `https://youtu.be/${v.id}` : `https://vimeo.com/${v.id}`), title: v.title })), gallery: x.gallery, sections: x.sections, footer: x.footer });
  // Pré-visualização ao vivo: renderiza o rascunho no servidor (nada é salvo) e mostra no painel lateral.
  const [html, setHtml] = useState(''); const [pvErr, setPvErr] = useState('');
  useEffect(() => {
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/site/preview', { method: 'POST', credentials: 'same-origin', signal: ctl.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(draftBody(s)) });
        if (!res.ok) { let m = 'Não foi possível atualizar a pré-visualização.'; try { m = (await res.json()).error ?? m; } catch { /* */ } setPvErr(m); return; }
        setHtml(await res.text()); setPvErr('');
      } catch (e) { if ((e as Error).name !== 'AbortError') setPvErr('Sem conexão para atualizar a pré-visualização.'); }
    }, html ? 400 : 0);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [s, ver]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    setBusy(true); setErr('');
    try { const r = await patch('/api/site', draftBody(s));
      setS(r.site); setSaved(JSON.stringify(r.site)); setVer((x) => x + 1); toast('Site atualizado'); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível salvar.'); } finally { setBusy(false); }
  };
  const refreshImages = async () => { const r = await get('/api/site'); setImages(r.images); };
  const send = async (files: FileList) => {
    setErr(''); let ok = 0;
    for (const f of Array.from(files)) { try { await upload('/api/site/images', f); ok++; } catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha no envio.'); } }
    if (ok) { toast(ok === 1 ? 'Foto enviada' : `${ok} fotos enviadas`); await refreshImages(); }
  };
  const remove = async (id: string) => {
    if (!(await ask('Excluir esta foto? Ela sai da capa, do “Sobre nós” e da galeria.', 'Excluir'))) return;
    await del(`/api/site/images/${id}`);
    setS((x: any) => ({ ...x, hero: { ...x.hero, images: x.hero.images.filter((i: string) => i !== id) }, about: { ...x.about, image: x.about.image === id ? '' : x.about.image }, gallery: x.gallery.filter((g: any) => g.id !== id) }));
    setSaved((sv) => { const o = JSON.parse(sv); o.hero.images = o.hero.images.filter((i: string) => i !== id); if (o.about.image === id) o.about.image = ''; o.gallery = o.gallery.filter((g: any) => g.id !== id); return JSON.stringify(o); });
    await refreshImages(); setVer((v) => v + 1);
  };
  const togglePick = (list: string[], id: string, max: number) => list.includes(id) ? list.filter((x) => x !== id) : [...list, id].slice(-max);
  const move = (i: number, d: number) => setS((x: any) => { const a = [...x.sections]; const j = i + d; if (j < 0 || j >= a.length) return x; [a[i], a[j]] = [a[j], a[i]]; return { ...x, sections: a }; });
  const addVideo = () => {
    const m = vidUrl.trim();
    if (!/^(https?:\/\/)?(www\.|m\.)?(youtube\.com|youtu\.be|vimeo\.com)\//i.test(m)) { setErr('Cole um link do YouTube ou do Vimeo.'); return; }
    setErr(''); setS((x: any) => ({ ...x, videos: [...x.videos, { url: /^https?:/.test(m) ? m : 'https://' + m, title: vidTitle.trim(), provider: /vimeo/.test(m) ? 'vimeo' : 'youtube', id: '' }] })); setVidUrl(''); setVidTitle('');
  };
  const t = s.theme;

  return (
    <div className="editor">
      <div>
        <Acc icon="palette" title="Aparência" hint="Cores, letras, cantos e estilo do topo" open>
          <Field label="Cores do fundo e do texto"><div className="swatches">{PRESETS.map(([n, bg, tx]) => <button key={n} type="button" className="swatch" title={n} aria-label={`Usar fundo ${n}`} style={{ background: `linear-gradient(135deg, ${bg} 50%, ${tx} 50%)` }} onClick={() => setS((x: any) => ({ ...x, theme: { ...x.theme, bg, text: tx } }))} />)}</div></Field>
          <div className="grid g2"><Color label="Fundo da página" value={t.bg} onChange={(v) => set('theme', 'bg', v)} /><Color label="Cor do texto" value={t.text} onChange={(v) => set('theme', 'text', v)} /></div>
          <p className="small muted">A cor principal e a de destaque (botões e selos) ficam em “Identidade”, junto com a logomarca.</p>
          <Field label="Topo do site"><Options value={t.header} onChange={(v) => set('theme', 'header', v)} options={[['claro', 'Claro', 'Fundo branco'], ['escuro', 'Escuro', 'Fundo grafite'], ['cor', 'Na cor da marca', 'Usa a cor principal']]} /></Field>
          <Field label="Capa (primeira tela)"><Options value={t.hero} onChange={(v) => set('theme', 'hero', v)} options={[['imagem', 'Foto grande', 'Foto de fundo com busca'], ['dividido', 'Dividida', 'Texto ao lado da foto'], ['cor', 'Só cor', 'Fundo na cor da marca']]} /></Field>
          <Field label="Lista de imóveis"><Options value={t.cards} onChange={(v) => set('theme', 'cards', v)} options={[['grade', 'Grade', 'Vários por linha'], ['lista', 'Lista', 'Um por linha, foto ao lado']]} /></Field>
          <div className="grid g2">
            <Field label="Letras"><Options value={t.font} onChange={(v) => set('theme', 'font', v)} options={[['moderna', 'Moderna', 'Sem serifa'], ['classica', 'Clássica', 'Títulos com serifa'], ['elegante', 'Elegante', 'Serifa refinada']]} /></Field>
            <Field label="Cantos"><Options value={t.radius} onChange={(v) => set('theme', 'radius', v)} options={[['reto', 'Retos', ''], ['suave', 'Suaves', ''], ['redondo', 'Arredondados', '']]} /></Field>
          </div>
        </Acc>

        <Acc icon="image" title="Capa" hint="Título, frase e fotos de fundo (até 6, trocam sozinhas)">
          <Field label="Título" hint="Em branco: nome da imobiliária."><input maxLength={80} value={s.hero.title} onChange={(e) => set('hero', 'title', e.target.value)} placeholder="Ex.: Encontre seu lugar" /></Field>
          <Field label="Frase abaixo do título"><input maxLength={160} value={s.hero.subtitle} onChange={(e) => set('hero', 'subtitle', e.target.value)} placeholder="Ex.: Casas, apartamentos, sítios e imóveis no litoral" /></Field>
          <Library label="Fotos da capa" max={6} images={images} selected={s.hero.images} onPick={(id) => set('hero', 'images', togglePick(s.hero.images, id, 6))} onUpload={send} onDelete={remove} />
          {!s.hero.images.length && <p className="small muted">Sem foto escolhida: a capa usa a foto do imóvel mais recente.</p>}
        </Acc>

        <Acc icon="layout" title="Seções e ordem" hint="Mostre, esconda e reordene as partes do site">
          <div>{s.sections.map((x: any, i: number) => (
            <div className="sec-row" key={x.id}><label className="row" style={{ flex: 1 }}><input type="checkbox" checked={x.on} onChange={(e) => setS((v: any) => ({ ...v, sections: v.sections.map((y: any) => y.id === x.id ? { ...y, on: e.target.checked } : y) }))} /><b>{SECTION_LABEL[x.id]}</b></label>
              <button type="button" className="iconbtn" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Subir ${SECTION_LABEL[x.id]}`}><Icon name="up" size={18} /></button><button type="button" className="iconbtn" disabled={i === s.sections.length - 1} onClick={() => move(i, 1)} aria-label={`Descer ${SECTION_LABEL[x.id]}`}><Icon name="down" size={18} /></button></div>))}</div>
          <p className="small muted">Seções sem conteúdo (ex.: “Vídeos” sem vídeos) não aparecem para o visitante.</p>
        </Acc>

        <Acc icon="text" title="Sobre nós" hint="Texto de apresentação e foto">
          <Field label="Título"><input maxLength={60} value={s.about.title} onChange={(e) => set('about', 'title', e.target.value)} /></Field>
          <Field label="Texto" hint={`${s.about.text.length}/2000`}><textarea rows={6} maxLength={2000} value={s.about.text} onChange={(e) => set('about', 'text', e.target.value)} placeholder="Conte a história da imobiliária, diferenciais, região de atuação…" /></Field>
          <Library label="Foto do “Sobre nós”" max={1} images={images} selected={s.about.image ? [s.about.image] : []} onPick={(id) => set('about', 'image', s.about.image === id ? '' : id)} onUpload={send} />
        </Acc>

        <Acc icon="video" title="Vídeos" hint="Links do YouTube ou do Vimeo (até 10)">
          {s.videos.map((v: any, i: number) => (
            <div className="video-item" key={i}><Icon name="video" size={22} /><div style={{ flex: 1, minWidth: 0 }}><input value={v.title} maxLength={80} placeholder="Título do vídeo" onChange={(e) => setS((x: any) => ({ ...x, videos: x.videos.map((y: any, j: number) => j === i ? { ...y, title: e.target.value } : y) }))} /><div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.url ?? (v.provider === 'youtube' ? `youtu.be/${v.id}` : `vimeo.com/${v.id}`)}</div></div>
              <button type="button" className="iconbtn" aria-label="Excluir vídeo" onClick={() => setS((x: any) => ({ ...x, videos: x.videos.filter((_: any, j: number) => j !== i) }))}><Icon name="trash" size={18} /></button></div>))}
          {s.videos.length < 10 && <div className="grid g2"><Field label="Link do vídeo"><input value={vidUrl} onChange={(e) => setVidUrl(e.target.value)} placeholder="https://youtu.be/…" inputMode="url" /></Field><Field label="Título (opcional)"><input value={vidTitle} maxLength={80} onChange={(e) => setVidTitle(e.target.value)} /></Field></div>}
          {s.videos.length < 10 && <button type="button" className="btn" onClick={addVideo} disabled={!vidUrl.trim()}><Icon name="plus" size={18} />Adicionar vídeo</button>}
          <p className="small muted">Para não estourar o armazenamento gratuito, o vídeo fica hospedado no YouTube ou no Vimeo e aparece incorporado no site.</p>
        </Acc>

        <Acc icon="image" title="Galeria de fotos" hint="Fotos da loja, equipe, região (até 30)">
          <Library label="Fotos na galeria" max={30} images={images} selected={s.gallery.map((g: any) => g.id)} onPick={(id) => setS((x: any) => ({ ...x, gallery: x.gallery.some((g: any) => g.id === id) ? x.gallery.filter((g: any) => g.id !== id) : [...x.gallery, { id, caption: '' }].slice(0, 30) }))} onUpload={send} onDelete={remove} />
          {s.gallery.length > 0 && <div className="stack">{s.gallery.map((g: any) => { const im = images.find((i) => i.id === g.id); return <div className="row" key={g.id}>{im && <img src={im.url} alt="" style={{ width: 64, height: 48, objectFit: 'cover', borderRadius: 8 }} />}<input style={{ flex: 1 }} maxLength={120} placeholder="Legenda (opcional)" value={g.caption} onChange={(e) => setS((x: any) => ({ ...x, gallery: x.gallery.map((y: any) => y.id === g.id ? { ...y, caption: e.target.value } : y) }))} /></div>; })}</div>}
        </Acc>

        <Acc icon="phone" title="Contato e rodapé" hint="Telefone, WhatsApp, endereço e redes sociais">
          <div className="grid g2">
            <Field label="WhatsApp" hint="Em branco: o WhatsApp do perfil público."><input inputMode="tel" maxLength={30} value={s.contact.whatsapp} onChange={(e) => set('contact', 'whatsapp', e.target.value)} placeholder="(11) 98888-7777" /></Field>
            <Field label="Telefone"><input inputMode="tel" maxLength={30} value={s.contact.phone} onChange={(e) => set('contact', 'phone', e.target.value)} /></Field>
            <Field label="E-mail"><input type="email" maxLength={120} value={s.contact.email} onChange={(e) => set('contact', 'email', e.target.value)} /></Field>
            <Field label="Horário de atendimento"><input maxLength={120} value={s.contact.hours} onChange={(e) => set('contact', 'hours', e.target.value)} placeholder="Seg. a sex., 9h às 18h" /></Field>
            <Field label="Instagram"><input maxLength={60} value={s.contact.instagram} onChange={(e) => set('contact', 'instagram', e.target.value)} placeholder="@suaimobiliaria" /></Field>
            <Field label="Facebook"><input maxLength={80} value={s.contact.facebook} onChange={(e) => set('contact', 'facebook', e.target.value)} placeholder="suaimobiliaria" /></Field>
          </div>
          <Field label="Endereço"><input maxLength={160} value={s.contact.address} onChange={(e) => set('contact', 'address', e.target.value)} /></Field>
          <Field label="Texto do rodapé" hint="Ex.: CRECI, CNPJ, aviso de valores."><input maxLength={300} value={s.footer} onChange={(e) => setS((x: any) => ({ ...x, footer: e.target.value }))} /></Field>
        </Acc>

        {err && <div className="alert err" role="alert">{err}</div>}
        <div className={`savebar ${dirty ? 'dirty' : ''}`}><span className="small muted">{dirty ? 'Alterações não salvas' : 'Tudo salvo'}</span><button className="btn" disabled={!dirty || busy} onClick={() => { setS(JSON.parse(saved)); setErr(''); }}>Desfazer</button><button className="btn primary" disabled={!dirty || busy} onClick={save}>{busy ? 'Salvando…' : 'Salvar e publicar'}</button></div>
      </div>

      <div className="preview">
        <div className="preview-bar"><b>Pré-visualização</b><div className="seg" role="group" aria-label="Tamanho da tela"><button className={device === 'phone' ? 'on' : ''} onClick={() => setDevice('phone')}>Celular</button><button className={device === 'desk' ? 'on' : ''} onClick={() => setDevice('desk')}>Computador</button></div>
          <button className="iconbtn" onClick={() => setVer((v) => v + 1)} aria-label="Recarregar pré-visualização"><Icon name="refresh" size={18} /></button>
          <a className="btn small right" href={data.preview_url.replace('?preview=1', '')} target="_blank" rel="noreferrer"><Icon name="eye" size={16} />Abrir site</a></div>
        <div className="small" style={{ padding: '.4rem .7rem', background: dirty ? 'var(--warn-soft)' : 'var(--ok-soft)', color: dirty ? 'var(--warn)' : 'var(--ok)' }}>{pvErr || (dirty ? 'Pré-visualização ao vivo. Estas mudanças ainda não foram publicadas: clique em “Salvar e publicar” se quiser mantê-las.' : 'Pré-visualização ao vivo. O site publicado está igual ao que você vê.')}</div>
        {html ? <Frame device={device} html={html} /> : <div className="small muted" style={{ padding: '1rem' }}>Carregando pré-visualização…</div>}
      </div>
      {node}
    </div>
  );
}
