import { escXml as esc, onColor, type Brand } from './brand.js';
import { SECTION_LABEL, embedUrl, filterProps, hasFilters, priceFor, socialUrl, type Filters, type Site } from './site.js';

/** Site público da imobiliária (vitrine): renderizado no servidor, sem dependências externas, leve no celular. */
export interface SiteCtx {
  org: { id: string; name: string; slug: string; plan: string; public_name?: string | null; public_whatsapp?: string | null; public_badge?: boolean };
  brand: Brand; site: Site; hasLogo: boolean; base: string; preview: boolean;
}
const brl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(n);
const AREA: Record<string, string> = { m2: 'm²', ha: 'ha', alqueire: 'alq.' };
export const SUBTYPE: Record<string, string> = {
  apartamento: 'Apartamento', casa: 'Casa', casa_condominio: 'Casa em condomínio', sobrado: 'Sobrado', kitnet: 'Kitnet', cobertura: 'Cobertura', terreno: 'Terreno', lote: 'Lote',
  sala_comercial: 'Sala comercial', loja: 'Loja', galpao: 'Galpão', predio: 'Prédio', outro: 'Outro', fazenda: 'Fazenda', sitio: 'Sítio', chacara: 'Chácara', terreno_rural: 'Terreno rural', propriedade_produtiva: 'Propriedade produtiva',
};
const subLabel = (s: string) => SUBTYPE[s] ?? (s ? s[0].toUpperCase() + s.slice(1).replace(/_/g, ' ') : '');
const FIN: Record<string, string> = { venda: 'Venda', aluguel: 'Aluguel', temporada: 'Temporada', arrendamento: 'Arrendamento' };
const ICON: Record<string, string> = {
  bed: '<path d="M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6M3 14h18M6 10V7h5v3"/>',
  bath: '<path d="M4 12h16v3a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zM6 12V6a2 2 0 0 1 4 0"/>',
  car: '<path d="M5 16h14l-1.5-5h-11zM7 16v2M17 16v2M6.5 11l1-3h9l1 3"/>',
  area: '<path d="M4 4h6M4 4v6M20 20h-6M20 20v-6M4 4l16 16"/>',
  pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  wa: '<path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z"/>', phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  mail: '<path d="M3 6h18v12H3zM3 7l9 6 9-6"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', play: '<path d="M8 5v14l11-7z"/>',
};
const ic = (k: string) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
const waLink = (num: string | null | undefined, text: string) => { const d = String(num ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, ''); return d.length >= 10 ? `https://wa.me/55${d}?text=${encodeURIComponent(text)}` : ''; };
export const siteImg = (slug: string, id: string, w = 1200) => `/api/public/site/${encodeURIComponent(slug)}/img/${id}?w=${w}`;
const photo = (id: string, w = 640) => `/api/public/files/${id}?w=${w}`;

function theme(c: SiteCtx) {
  const t = c.site.theme, P = c.brand.primary, S = c.brand.secondary;
  const dark = onColor(t.bg) === '#ffffff';
  const head = t.header === 'escuro' ? ['#0f172a', '#ffffff'] : t.header === 'cor' ? [P, onColor(P)] : [dark ? 'color-mix(in srgb,var(--bg) 85%,#fff)' : '#ffffff', t.text];
  const font = { moderna: 'system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif', classica: 'Georgia,"Times New Roman",serif', elegante: '"Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif' }[t.font];
  const r = { reto: '4px', suave: '14px', redondo: '24px' }[t.radius];
  return `:root{--p:${P};--pt:${dark ? 'color-mix(in srgb,var(--p) 45%,#fff)' : 'var(--p)'};--pf:${onColor(P)};--s:${S};--sf:${onColor(S)};--bg:${t.bg};--tx:${t.text};--card:${dark ? 'color-mix(in srgb,var(--bg) 88%,#fff)' : '#ffffff'};--line:color-mix(in srgb,var(--tx) 13%,transparent);--mut:color-mix(in srgb,var(--tx) 66%,transparent);--hb:${head[0]};--hf:${head[1]};--r:${r};--fh:${font};--fb:${t.font === 'moderna' ? font : 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif'}}`;
}

const CSS = `*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:76px}body{margin:0;font:16px/1.55 var(--fb);color:var(--tx);background:var(--bg);-webkit-font-smoothing:antialiased}a{color:inherit;text-decoration:none}img{max-width:100%;display:block}
h1,h2,h3{font-family:var(--fh);line-height:1.15;margin:0;letter-spacing:-.01em}.w{width:100%;max-width:1200px;margin:0 auto;padding:0 16px}.ic{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:none}
.hd{position:sticky;top:0;z-index:30;background:var(--hb);color:var(--hf);border-bottom:1px solid var(--line);backdrop-filter:saturate(1.4) blur(8px)}.hd .w{display:flex;align-items:center;gap:16px;min-height:68px}.lg{display:flex;align-items:center;gap:10px;font-weight:800;font-size:1.15rem;font-family:var(--fh);min-width:0}.lg img{height:46px;width:auto;max-width:170px;object-fit:contain;background:#fff;border-radius:8px;padding:3px}.lg span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mn{margin-left:auto;display:flex;gap:4px;align-items:center}.mn a{padding:8px 12px;border-radius:999px;font-size:.95rem;font-weight:600;opacity:.88}.mn a:hover{opacity:1;background:color-mix(in srgb,currentColor 10%,transparent)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:46px;padding:10px 20px;border-radius:var(--r);border:0;font:inherit;font-weight:700;cursor:pointer;background:var(--p);color:var(--pf);transition:transform .12s,box-shadow .12s}.btn:hover{transform:translateY(-1px);box-shadow:0 6px 18px #0002}.btn.s{background:var(--s);color:var(--sf)}.btn.o{background:transparent;color:inherit;border:1.5px solid currentColor}.btn.wa{background:#1f9d55;color:#fff}
.mt{display:none}.mt summary{list-style:none;cursor:pointer;padding:8px;border-radius:10px}.mt summary::-webkit-details-marker{display:none}.mt nav{position:absolute;right:12px;top:64px;background:var(--card);color:var(--tx);border:1px solid var(--line);border-radius:14px;box-shadow:0 14px 40px #0003;padding:8px;min-width:220px;display:flex;flex-direction:column}.mt nav a{padding:12px 14px;border-radius:10px;font-weight:600}.mt nav a:hover{background:var(--bg)}
@media(max-width:860px){.mn{display:none}.mt{display:block;margin-left:auto}.hd .btn.wa{display:none}}
.hero{position:relative;color:#fff;background:var(--p);overflow:hidden}.hero .sl{position:absolute;inset:0}.hero .sl img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;animation:fade var(--dur) infinite}.hero .sl img:only-child{opacity:1;animation:none}.hero:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,#0006,#000a)}
.hero .w{position:relative;z-index:2;padding-top:72px;padding-bottom:56px}.hero h1{font-size:clamp(2rem,5vw,3.4rem);max-width:820px;text-wrap:balance}.hero p{font-size:clamp(1.05rem,2vw,1.3rem);max-width:640px;margin:14px 0 26px;opacity:.95}
.hero.cor{background:linear-gradient(135deg,var(--p),color-mix(in srgb,var(--p) 55%,#000));color:var(--pf)}.hero.cor:after,.hero.div:after{display:none}.hero.div{background:var(--card);color:var(--tx)}.hero.div .w{display:grid;grid-template-columns:1.1fr 1fr;gap:40px;align-items:center;padding-top:48px}.hero.div .pic{border-radius:var(--r);overflow:hidden;aspect-ratio:4/3;background:var(--line)}.hero.div .pic img{width:100%;height:100%;object-fit:cover}@media(max-width:860px){.hero.div .w{grid-template-columns:1fr}.hero.div .pic{order:-1}}
.sch{background:var(--card);color:var(--tx);border-radius:calc(var(--r) + 4px);padding:10px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) auto;gap:8px;box-shadow:0 18px 50px #0004;max-width:920px}.sch label{display:flex;flex-direction:column;font-size:.75rem;font-weight:700;color:var(--mut);padding:4px 8px;text-transform:uppercase;letter-spacing:.04em}
.sch select,.flt select,.flt input,.fm input,.fm select,.fm textarea{font:inherit;font-size:1rem;color:var(--tx);background:transparent;border:0;padding:4px 0;min-height:32px;text-transform:none;letter-spacing:0;font-weight:500;width:100%}.sch .btn{min-height:56px}
@media(max-width:760px){.sch{grid-template-columns:1fr 1fr}.sch .btn{grid-column:1/-1}}
.cats{display:flex;gap:10px;overflow-x:auto;padding:18px 0 4px;scrollbar-width:none}.cats a{flex:none;display:flex;flex-direction:column;padding:12px 18px;border-radius:var(--r);background:var(--card);border:1px solid var(--line);font-weight:700;min-width:150px}.cats a small{font-weight:500;color:var(--mut)}.cats a:hover,.cats a.on{border-color:var(--pt);color:var(--pt)}
section.sc{padding:48px 0}section.sc+section.sc{padding-top:8px}.st{display:flex;align-items:end;justify-content:space-between;gap:12px;margin-bottom:20px;flex-wrap:wrap}.st h2{font-size:clamp(1.5rem,3vw,2rem)}.st p{margin:4px 0 0;color:var(--mut)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,290px),1fr));gap:22px}
.pc{background:var(--card);border-radius:var(--r);overflow:hidden;display:flex;flex-direction:column;border:1px solid var(--line);transition:box-shadow .18s,transform .18s}.pc:hover{box-shadow:0 16px 40px #0002;transform:translateY(-3px)}
.pc .ph{position:relative;aspect-ratio:4/3;background:var(--line)}.pc .ph img{width:100%;height:100%;object-fit:cover}.pc .ni{display:grid;place-items:center;height:100%;color:var(--mut);font-size:.9rem}
.bdg{position:absolute;top:12px;left:12px;display:flex;gap:6px;flex-wrap:wrap}.bdg span{background:#fff;color:#111827;font-size:.75rem;font-weight:700;padding:4px 10px;border-radius:999px;box-shadow:0 2px 6px #0002}.bdg span.f{background:var(--s);color:var(--sf)}.cnt{position:absolute;right:10px;bottom:10px;background:#000b;color:#fff;font-size:.75rem;padding:3px 9px;border-radius:999px;display:flex;gap:4px;align-items:center}.cnt .ic{width:13px;height:13px}
.pc .bd{padding:16px 18px 18px;display:flex;flex-direction:column;gap:6px;flex:1}.pr{font-size:1.35rem;font-weight:800;color:var(--pt)}.pr small{font-size:.8rem;font-weight:600;color:var(--mut)}.pr.c{font-size:1rem;color:var(--mut)}.pc h3{font-size:1.08rem}.loc{display:flex;gap:4px;align-items:center;color:var(--mut);font-size:.9rem}.loc .ic{width:15px;height:15px}
.fx{display:flex;gap:14px;flex-wrap:wrap;color:var(--tx);font-size:.9rem;padding-top:8px;margin-top:auto;border-top:1px solid var(--line)}.fx span{display:flex;gap:5px;align-items:center}.fx .ic{width:16px;height:16px;color:var(--mut)}.ds{color:var(--mut);font-size:.92rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin:0}
.lista .grid{grid-template-columns:1fr}.lista .pc{flex-direction:row}.lista .pc .ph{width:min(42%,380px);flex:none;aspect-ratio:auto;min-height:220px}@media(max-width:620px){.lista .pc{flex-direction:column}.lista .pc .ph{width:100%;aspect-ratio:4/3;min-height:0}}
.flt{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:8px;margin-bottom:22px}.flt summary{display:none}.flt .fg{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:4px}.flt label{display:flex;flex-direction:column;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--mut);padding:6px 10px;border-radius:10px}.flt label:focus-within{background:var(--bg)}.flt .ac{display:flex;gap:8px;align-items:center;padding:6px 8px;justify-content:flex-end;flex-wrap:wrap}
@media(max-width:760px){.flt summary{display:flex;justify-content:space-between;align-items:center;cursor:pointer;font-weight:700;padding:8px 10px;list-style:none}.flt summary::-webkit-details-marker{display:none}.flt details:not([open]) .fg,.flt details:not([open]) .ac{display:none}.flt .fg{grid-template-columns:1fr 1fr}}
.lnk{color:var(--pt);font-weight:700}.emp{text-align:center;padding:48px 16px;background:var(--card);border-radius:var(--r);border:1px dashed var(--line);color:var(--mut)}
.svc{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:16px}.svc div{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:22px;font-weight:700;font-size:1.05rem;display:flex;gap:12px;align-items:center}.svc i{width:40px;height:40px;border-radius:12px;background:color-mix(in srgb,var(--s) 20%,transparent);color:var(--s);display:grid;place-items:center;font-style:normal;font-weight:800;flex:none}
.ab{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center}.ab .pic{border-radius:var(--r);overflow:hidden;aspect-ratio:4/3}.ab .pic img{width:100%;height:100%;object-fit:cover}.ab p{white-space:pre-line;color:var(--mut);font-size:1.05rem}@media(max-width:860px){.ab{grid-template-columns:1fr}}
.vds{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:22px}.vd{background:var(--card);border-radius:var(--r);overflow:hidden;border:1px solid var(--line)}.vd .fr{aspect-ratio:16/9;background:#000}.vd iframe{width:100%;height:100%;border:0;display:block}.vd b{display:block;padding:12px 16px}
.gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,220px),1fr));gap:12px}.gal figure{margin:0;border-radius:var(--r);overflow:hidden;background:var(--line);position:relative}.gal img{width:100%;aspect-ratio:1;object-fit:cover}.gal figcaption{position:absolute;inset:auto 0 0;padding:20px 12px 10px;background:linear-gradient(transparent,#000a);color:#fff;font-size:.88rem}
.fm{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:22px;display:grid;gap:12px}.fm label{display:flex;flex-direction:column;gap:4px;font-weight:600;font-size:.92rem}.fm input,.fm select,.fm textarea{border:1.5px solid var(--line);border-radius:10px;padding:10px 12px;min-height:46px;background:var(--bg)}.fm input:focus,.fm select:focus,.fm textarea:focus{outline:2px solid var(--p);border-color:transparent}.fm .ck{flex-direction:row;align-items:flex-start;gap:10px;font-weight:400;font-size:.88rem;color:var(--mut)}.fm .ck input{width:auto;min-height:0;margin-top:3px}.fm .two{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:560px){.fm .two{grid-template-columns:1fr}}.fm [role=status]{margin:0;font-weight:600}.hp{position:absolute;left:-9999px}
.av{display:grid;grid-template-columns:1fr 1.2fr;gap:40px;align-items:start}@media(max-width:860px){.av{grid-template-columns:1fr}}.av ul{padding:0;list-style:none;display:grid;gap:10px}.av li{display:flex;gap:10px}.av li:before{content:"✓";color:var(--s);font-weight:800}
.ct{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr));gap:16px}.ct a,.ct div{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:18px;display:flex;gap:12px;align-items:flex-start}.ct .ic{width:22px;height:22px;color:var(--pt)}.ct small{display:block;color:var(--mut)}
footer{background:color-mix(in srgb,var(--tx) 92%,var(--bg));color:color-mix(in srgb,var(--bg) 85%,transparent);padding:36px 0 calc(36px + env(safe-area-inset-bottom));margin-top:48px;font-size:.92rem}footer .w{display:flex;flex-wrap:wrap;gap:16px;justify-content:space-between}footer a{text-decoration:underline}
.fab{position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:40;width:58px;height:58px;border-radius:50%;background:#1f9d55;color:#fff;display:grid;place-items:center;box-shadow:0 8px 24px #0004}.fab .ic{width:28px;height:28px}
.crumb{padding:16px 0;font-size:.9rem;color:var(--mut)}.crumb a{color:var(--pt);font-weight:600}
.pg{display:grid;grid-template-columns:2fr 1fr 1fr;grid-template-rows:200px 200px;gap:8px;border-radius:var(--r);overflow:hidden}.pg a{position:relative;background:var(--line)}.pg a:first-child{grid-row:1/3}.pg img{width:100%;height:100%;object-fit:cover}.pg .more{position:absolute;inset:0;display:grid;place-items:center;background:#0008;color:#fff;font-weight:700}
.pg.n1{grid-template-columns:1fr;grid-template-rows:420px}.pg.n2{grid-template-columns:1fr 1fr;grid-template-rows:380px}.pg.n2 a:first-child,.pg.n1 a:first-child{grid-row:auto}.pg.n3{grid-template-columns:2fr 1fr}.pg.n4 a:nth-child(4){grid-column:2/4}
@media(max-width:760px){.pg,.pg.n1,.pg.n2,.pg.n3{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;grid-template-rows:none;border-radius:0;margin:0 -16px}.pg a{flex:0 0 88%;height:280px;scroll-snap-align:center}.pg a:only-child{flex-basis:100%}.pg .more{display:none}}
.dt{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:36px;margin-top:26px;align-items:start}@media(max-width:960px){.dt{grid-template-columns:1fr}}.dt h1{font-size:clamp(1.6rem,3.5vw,2.3rem)}.box{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:22px;margin-top:22px}.box h2{font-size:1.25rem;margin-bottom:12px}.box p{white-space:pre-wrap;margin:0;color:var(--mut)}
.kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-top:18px}.kv div{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:14px;display:flex;flex-direction:column;gap:2px}.kv b{font-size:1.15rem}.kv small{color:var(--mut);display:flex;gap:6px;align-items:center}
.tags{display:flex;flex-wrap:wrap;gap:8px}.tags span{background:color-mix(in srgb,var(--p) 10%,transparent);color:var(--pt);padding:6px 12px;border-radius:999px;font-size:.88rem;font-weight:600}
aside.ask{position:sticky;top:88px}aside .pr{font-size:1.8rem}aside .pl{display:grid;gap:8px;margin-bottom:16px}aside .pl div{display:flex;justify-content:space-between;align-items:baseline;gap:8px;border-bottom:1px solid var(--line);padding-bottom:8px}aside .pl div:last-child{border:0}aside .fm{padding:0;border:0}aside .btn{width:100%}
dialog.lb{width:100%;height:100%;max-width:none;max-height:none;margin:0;padding:0;border:0;background:#000e}dialog.lb .ls{height:100%;overflow-y:auto;padding:56px 12px 24px;display:grid;gap:12px;justify-items:center}dialog.lb img{max-height:88vh;width:auto;border-radius:6px}dialog.lb button{position:fixed;top:10px;right:14px;background:#fff;border:0;border-radius:999px;padding:8px 16px;font:inherit;font-weight:700;cursor:pointer}
.warn{background:#fef3c7;color:#92400e;padding:12px 16px;border-radius:var(--r);margin-top:16px}.pv{background:#111827;color:#fff;text-align:center;font-size:.85rem;padding:6px}
:focus-visible{outline:3px solid var(--s);outline-offset:2px}@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important;scroll-behavior:auto!important}.hero .sl img:first-child{opacity:1}}`;

function head(c: SiteCtx, o: { title: string; desc: string; url: string; img?: string; ld?: object }) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(o.title)}</title><meta name="description" content="${esc(o.desc)}"><link rel="canonical" href="${esc(o.url)}"><meta name="theme-color" content="${esc(c.brand.primary)}">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(o.title)}"><meta property="og:description" content="${esc(o.desc)}"><meta property="og:url" content="${esc(o.url)}">${o.img ? `<meta property="og:image" content="${esc(o.img)}"><meta name="twitter:card" content="summary_large_image">` : ''}
${c.hasLogo ? `<link rel="icon" href="/api/public/brand/${esc(c.org.slug)}/logo">` : ''}${c.preview ? '<meta name="robots" content="noindex">' : ''}
${o.ld ? `<script type="application/ld+json">${JSON.stringify(o.ld).replace(/</g, '\\u003c')}</script>` : ''}
<style>${theme(c)}${CSS}</style></head><body>${c.preview ? '<div class="pv">Pré-visualização — é assim que os visitantes veem o seu site.</div>' : ''}`;
}

const orgName = (c: SiteCtx) => c.org.public_name || c.org.name;
const whats = (c: SiteCtx) => c.site.contact.whatsapp || c.org.public_whatsapp || '';
function header(c: SiteCtx, home: boolean) {
  const root = `/v/${encodeURIComponent(c.org.slug)}`; const on = new Set(c.site.sections.filter((s) => s.on).map((s) => s.id));
  const links = ([['imoveis', 'Imóveis'], ['servicos', 'Serviços'], ['sobre', 'Sobre'], ['avaliacao', 'Avaliação'], ['contato', 'Contato']] as const).filter(([k]) => on.has(k)).map(([k, l]) => `<a href="${home ? '' : root}#${k}">${l}</a>`).join('');
  const wa = waLink(whats(c), `Olá! Vim pelo site da ${orgName(c)}.`);
  return `<header class="hd"><div class="w"><a class="lg" href="${root}">${c.hasLogo ? `<img src="/api/public/brand/${esc(c.org.slug)}/logo" alt="">` : ''}<span>${esc(c.brand.title || orgName(c))}</span></a>
<nav class="mn" aria-label="Seções">${links}</nav>${wa ? `<a class="btn wa" href="${esc(wa)}" rel="noopener">${ic('wa')} WhatsApp</a>` : ''}
<details class="mt"><summary aria-label="Abrir menu"><svg class="ic" viewBox="0 0 24 24" style="width:26px;height:26px"><path d="M4 7h16M4 12h16M4 17h16"/></svg></summary><nav aria-label="Menu">${links}${wa ? `<a href="${esc(wa)}" rel="noopener">WhatsApp</a>` : ''}</nav></details></div></header>`;
}
function footer(c: SiteCtx) {
  const badge = c.org.public_badge || c.org.plan === 'gratuito';
  const ig = socialUrl('instagram', c.site.contact.instagram), fb = socialUrl('facebook', c.site.contact.facebook);
  const wa = waLink(whats(c), `Olá! Vim pelo site da ${orgName(c)}.`);
  return `<footer><div class="w"><div><b>${esc(orgName(c))}</b><br>${esc(c.site.footer || 'Valores e disponibilidade podem mudar sem aviso.')}</div><div>${[ig && `<a href="${esc(ig)}" rel="noopener">Instagram</a>`, fb && `<a href="${esc(fb)}" rel="noopener">Facebook</a>`].filter(Boolean).join(' · ')}${badge ? `<br>Site feito com <a href="${esc(c.base)}/cadastrar?ref=${esc(c.org.slug)}">ImobFlow</a>` : ''}</div></div></footer>
${wa ? `<a class="fab" href="${esc(wa)}" rel="noopener" aria-label="Conversar no WhatsApp">${ic('wa')}</a>` : ''}`;
}

function prices(p: any, fin?: string) {
  if (!p.show_price) return '<div class="pr c">Valor sob consulta</div>';
  const list = ([['venda', p.price_sale, ''], ['aluguel', p.price_rent, '/mês'], ['arrendamento', p.price_lease, '/ano']] as const).filter(([, v]) => v != null);
  if (!list.length) return '<div class="pr c">Valor sob consulta</div>';
  const main = list.find(([k]) => k === fin || (fin === 'temporada' && k === 'aluguel')) ?? list[0];
  return `<div class="pr"><small>${FIN[main[0]]} </small>${brl(Number(main[1]))}<small>${main[2]}</small></div>`;
}
const facts = (p: any) => [p.bedrooms != null && `<span>${ic('bed')}${p.bedrooms} ${p.bedrooms === 1 ? 'quarto' : 'quartos'}</span>`, p.bathrooms != null && `<span>${ic('bath')}${p.bathrooms} banh.</span>`, p.parking != null && `<span>${ic('car')}${p.parking} ${p.parking === 1 ? 'vaga' : 'vagas'}</span>`, p.area_total && `<span>${ic('area')}${Number(p.area_total).toLocaleString('pt-BR')} ${AREA[p.area_unit] ?? ''}</span>`].filter(Boolean).join('');
const place = (p: any) => [p.neighborhood, p.city && `${p.city}${p.state ? '/' + p.state : ''}`].filter(Boolean).join(', ');

export function propCard(c: SiteCtx, p: any, fin?: string) {
  const href = `/v/${encodeURIComponent(c.org.slug)}/imovel/${esc(p.public_code)}`;
  const badges = [p.featured && '<span class="f">Destaque</span>', ...p.purposes.slice(0, 2).map((x: string) => `<span>${esc(FIN[x] ?? x)}</span>`)].filter(Boolean).join('');
  return `<a class="pc" href="${href}"><div class="ph">${p.cover_id ? `<img src="${photo(p.cover_id)}" alt="${esc(p.title)}" loading="lazy" decoding="async">` : '<div class="ni">Sem foto</div>'}<div class="bdg">${badges}</div>${p.photo_count > 1 || p.video_count ? `<span class="cnt">${p.photo_count > 1 ? `${p.photo_count} fotos` : ''}${p.video_count ? `${p.photo_count > 1 ? ' · ' : ''}${ic('play')}vídeo` : ''}</span>` : ''}</div>
<div class="bd">${prices(p, fin)}<h3>${esc(p.title)}</h3><div class="loc">${ic('pin')}${esc([subLabel(p.subtype), place(p)].filter(Boolean).join(' · '))}</div>${p.description ? `<p class="ds">${esc(String(p.description).replace(/\s+/g, ' ').slice(0, 220))}</p>` : ''}${facts(p) ? `<div class="fx">${facts(p)}</div>` : ''}</div></a>`;
}

function filterForm(c: SiteCtx, rows: any[], f: Filters, count: number) {
  const opt = (v: string, l: string, cur?: string | number) => `<option value="${esc(v)}"${String(cur ?? '') === v ? ' selected' : ''}>${esc(l)}</option>`;
  const types = [...new Set(rows.map((r) => r.subtype))].sort((a, b) => subLabel(a).localeCompare(subLabel(b)));
  const cities = [...new Set(rows.map((r) => r.city).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const active = hasFilters(f);
  return `<form class="flt" method="get" action="/v/${encodeURIComponent(c.org.slug)}#imoveis"><details open data-active="${active ? 1 : 0}"><summary>Filtrar imóveis <span class="lnk">${count} resultado(s)</span></summary>
<div class="fg"><label>Finalidade<select name="fin">${opt('', 'Todas', f.fin)}${Object.entries(FIN).map(([k, l]) => opt(k, l, f.fin)).join('')}</select></label>
<label>Tipo<select name="tipo">${opt('', 'Todos', f.tipo)}${types.map((t) => opt(t, subLabel(t), f.tipo)).join('')}</select></label>
<label>Cidade<select name="cidade">${opt('', 'Todas', f.cidade)}${cities.map((t) => opt(t, t, f.cidade)).join('')}</select></label>
<label>Região<select name="zona">${opt('', 'Todas', f.zona)}${opt('urbano', 'Urbano', f.zona)}${opt('rural', 'Rural', f.zona)}${opt('litoral', 'Litoral', f.zona)}</select></label>
<label>Preço mínimo<input name="min" inputmode="numeric" placeholder="R$" value="${f.min ?? ''}"></label><label>Preço máximo<input name="max" inputmode="numeric" placeholder="R$" value="${f.max ?? ''}"></label>
<label>Quartos<select name="quartos">${opt('', 'Qualquer', f.quartos)}${[1, 2, 3, 4].map((n) => opt(String(n), `${n}+`, f.quartos)).join('')}</select></label>
<label>Vagas<select name="vagas">${opt('', 'Qualquer', f.vagas)}${[1, 2, 3].map((n) => opt(String(n), `${n}+`, f.vagas)).join('')}</select></label>
<label>Área mínima<input name="area" inputmode="numeric" placeholder="m² ou ha" value="${f.area ?? ''}"></label>
<label>Palavra-chave<input name="q" type="search" placeholder="piscina, centro…" value="${esc(f.q ?? '')}" maxlength="60"></label>
<label>Ordenar<select name="ordem">${opt('recentes', 'Mais recentes', f.ordem)}${opt('menor', 'Menor preço', f.ordem)}${opt('maior', 'Maior preço', f.ordem)}${opt('area', 'Maior área', f.ordem)}</select></label></div>
<div class="ac">${active ? `<a class="lnk" href="/v/${encodeURIComponent(c.org.slug)}#imoveis">Limpar filtros</a>` : ''}<button class="btn" type="submit">Ver ${count} imóve${count === 1 ? 'l' : 'is'}</button></div></details></form>`;
}

function appraisal(c: SiteCtx, token: string, consent: string) {
  return `<div class="av"><div><h2>Quanto vale o seu imóvel?</h2><p style="color:var(--mut)">Conte um pouco sobre o imóvel e combinamos a avaliação com um corretor.</p><ul><li>Urbanos, rurais e no litoral</li><li>Venda, aluguel ou arrendamento</li><li>Sem compromisso</li></ul></div>
<form class="fm" id="af" novalidate data-token="${esc(token)}"><div class="two"><label>Seu nome<input name="name" required maxlength="120" autocomplete="name"></label><label>Telefone com DDD<input name="phone" inputmode="tel" autocomplete="tel"></label></div><label>E-mail<input name="email" type="email" autocomplete="email"></label>
<div class="two"><label>Tipo de imóvel<select name="property_type"><option value="casa">Casa</option><option value="apartamento">Apartamento</option><option value="terreno">Terreno</option><option value="rural">Rural (sítio, fazenda, chácara)</option><option value="comercial">Comercial</option><option value="outro">Outro</option></select></label><label>Bairro e cidade<input name="address" required maxlength="200" placeholder="Ex.: Centro, Campinas/SP"></label></div>
<label>Observações (opcional)<textarea name="message" rows="3" maxlength="1000"></textarea></label><div class="hp" aria-hidden="true"><label>Site<input name="website" tabindex="-1" autocomplete="off"></label></div>
<label class="ck"><input type="checkbox" name="consent"> <span>${esc(consent)}</span></label><button class="btn" type="submit">Solicitar avaliação</button><p role="status"></p></form></div>`;
}

const SCRIPT = (slug: string) => `<script>(function(){var sl=${JSON.stringify(slug)};
function send(f,url,body,ok){var m=f.querySelector('[role=status]');var v=Object.fromEntries(new FormData(f));
 if(!v.name||v.name.trim().length<2){m.textContent='Informe seu nome.';return}
 if(!v.phone&&!v.email){m.textContent='Informe telefone ou e-mail para retornarmos.';return}
 if(f.address&&(!v.address||v.address.trim().length<3)){m.textContent='Informe o bairro e a cidade do imóvel.';return}
 if(!f.consent.checked){m.textContent='Marque a autorização para enviarmos seu contato.';return}
 m.textContent='Enviando…';
 fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body(v))}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'Erro');m.textContent=ok;f.reset();})}).catch(function(e){m.textContent=e.message||'Não foi possível enviar. Tente de novo.'});}
var af=document.getElementById('af');if(af)af.addEventListener('submit',function(e){e.preventDefault();send(af,'/api/public/vitrine/'+sl+'/avaliacao',function(v){return{token:af.dataset.token,name:v.name,phone:v.phone||undefined,email:v.email||undefined,property_type:v.property_type,address:v.address,message:v.message||undefined,website:v.website||'',consent:true}},'Recebemos seu pedido! Entraremos em contato para combinar a avaliação.')});
var lf=document.getElementById('lf');if(lf)lf.addEventListener('submit',function(e){e.preventDefault();send(lf,'/api/public/leads',function(v){return{code:lf.dataset.code,token:lf.dataset.token,name:v.name,phone:v.phone||undefined,email:v.email||undefined,message:v.message||undefined,website:v.website||'',consent:true,ref:'vitrine'}},'Recebemos seu contato! Em breve retornaremos.')});
var fd=document.querySelector('.flt details');if(fd&&fd.dataset.active==='0'&&matchMedia('(max-width:760px)').matches)fd.open=false;
document.querySelectorAll('.flt select').forEach(function(s){s.addEventListener('change',function(){if(matchMedia('(min-width:761px)').matches)s.form.submit()})});
var lb=document.getElementById('lb');document.querySelectorAll('[data-lb]').forEach(function(a){a.addEventListener('click',function(e){if(!lb||!lb.showModal)return;e.preventDefault();lb.showModal();var t=document.getElementById(a.dataset.lb);if(t)t.scrollIntoView()})});
if(lb)lb.querySelector('button').addEventListener('click',function(){lb.close()});
document.querySelectorAll('.mt nav a').forEach(function(a){a.addEventListener('click',function(){a.closest('details').open=false})});})();</script>`;

export function renderHome(c: SiteCtx, rows: any[], f: Filters, appraisalToken: string, consent: string) {
  const name = orgName(c), root = `/v/${encodeURIComponent(c.org.slug)}`, url = `${c.base}${root}`;
  const s = c.site, list = filterProps(rows, f), active = hasFilters(f);
  const covers = s.hero.images.length ? s.hero.images.map((id) => siteImg(c.org.slug, id, 1600)) : rows.filter((r) => r.cover_id).slice(0, 1).map((r) => photo(r.cover_id, 1600));
  const title = s.hero.title || c.brand.title || name, sub = s.hero.subtitle || c.brand.tagline || 'Encontre o imóvel certo para comprar, alugar ou arrendar.';
  const types = [...new Set(rows.map((r) => r.subtype))];
  const cities = [...new Set(rows.map((r) => r.city).filter(Boolean))].sort();
  const search = `<form class="sch" method="get" action="${root}#imoveis"><label>Quero<select name="fin"><option value="">Comprar ou alugar</option>${Object.entries(FIN).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
<label>Tipo<select name="tipo"><option value="">Todos</option>${types.map((t) => `<option value="${esc(t)}">${esc(subLabel(t))}</option>`).join('')}</select></label><label>Cidade<select name="cidade"><option value="">Todas</option>${cities.map((t) => `<option>${esc(t)}</option>`).join('')}</select></label><button class="btn s" type="submit">Buscar imóveis</button></form>`;
  const heroCls = s.theme.hero === 'imagem' && covers.length ? '' : s.theme.hero === 'dividido' ? 'div' : 'cor';
  const hero = `<section class="hero ${heroCls}" style="--dur:${Math.max(1, covers.length) * 6}s">${covers.length > 1 ? `<style>@keyframes fade{0%{opacity:0}${(Math.min(8, 25 / covers.length)).toFixed(2)}%{opacity:1}${(100 / covers.length).toFixed(2)}%{opacity:1}${(100 / covers.length + Math.min(8, 25 / covers.length)).toFixed(2)}%{opacity:0}100%{opacity:0}}</style>` : ''}${heroCls === '' ? `<div class="sl">${covers.map((src, i) => `<img src="${esc(src)}" alt="" style="animation-delay:${i * 6}s"${i ? ' loading="lazy"' : ' fetchpriority="high"'}>`).join('')}</div>` : ''}
<div class="w"><div><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}${search}</div>${heroCls === 'div' && covers[0] ? `<div class="pic"><img src="${esc(covers[0])}" alt=""></div>` : ''}</div></section>`;
  const count = (fn: (r: any) => boolean) => rows.filter(fn).length;
  const cats = ([['fin=venda', 'Comprar', count((r) => r.purposes.includes('venda'))], ['fin=aluguel', 'Alugar', count((r) => r.purposes.includes('aluguel'))], ['zona=litoral', 'Litoral e temporada', count((r) => (r.location_tags ?? []).includes('litoral') || r.purposes.includes('temporada'))], ['zona=rural', 'Rural e arrendamento', count((r) => r.kind === 'rural')]] as const)
    .filter(([, , n]) => n > 0).map(([qs, l, n]) => `<a href="${root}?${qs}#imoveis" class="${(f.fin && qs === `fin=${f.fin}`) || (f.zona && qs === `zona=${f.zona}`) ? 'on' : ''}">${l}<small>${n} imóve${n === 1 ? 'l' : 'is'}</small></a>`).join('');
  const featured = rows.filter((r) => r.featured).slice(0, 6);
  const svcs = c.brand.services;
  const sec: Record<string, () => string> = {
    destaques: () => !active && featured.length ? `<section class="sc ${s.theme.cards === 'lista' ? 'lista' : ''}" id="destaques"><div class="w"><div class="st"><div><h2>Destaques</h2><p>Selecionados pela nossa equipe</p></div></div><div class="grid">${featured.map((p) => propCard(c, p)).join('')}</div></div></section>` : '',
    imoveis: () => `<section class="sc ${s.theme.cards === 'lista' ? 'lista' : ''}" id="imoveis"><div class="w"><div class="st"><div><h2>${active ? 'Resultado da busca' : 'Todos os imóveis'}</h2><p>${list.length} de ${rows.length} imóve${rows.length === 1 ? 'l' : 'is'} disponíve${rows.length === 1 ? 'l' : 'is'}</p></div></div>
${rows.length ? filterForm(c, rows, f, list.length) : ''}${list.length ? `<div class="grid">${list.map((p) => propCard(c, p, f.fin)).join('')}</div>` : `<div class="emp">${rows.length ? `Nenhum imóvel com esses filtros. <a class="lnk" href="${root}#imoveis">Limpar filtros</a>` : 'Nenhum imóvel disponível no momento. Volte em breve!'}</div>`}</div></section>`,
    servicos: () => svcs.length ? `<section class="sc" id="servicos"><div class="w"><div class="st"><h2>Nossos serviços</h2></div><div class="svc">${svcs.map((t, i) => `<div><i>${i + 1}</i>${esc(t)}</div>`).join('')}</div></div></section>` : '',
    sobre: () => s.about.text ? `<section class="sc" id="sobre"><div class="w ab"><div><h2>${esc(s.about.title || 'Sobre nós')}</h2><p>${esc(s.about.text)}</p></div>${s.about.image ? `<div class="pic"><img src="${esc(siteImg(c.org.slug, s.about.image, 1000))}" alt="" loading="lazy"></div>` : ''}</div></section>` : '',
    videos: () => s.videos.length ? `<section class="sc" id="videos"><div class="w"><div class="st"><h2>Vídeos</h2></div><div class="vds">${s.videos.map((v) => `<div class="vd"><div class="fr"><iframe src="${esc(embedUrl(v))}" title="${esc(v.title || 'Vídeo')}" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>${v.title ? `<b>${esc(v.title)}</b>` : ''}</div>`).join('')}</div></div></section>` : '',
    galeria: () => s.gallery.length ? `<section class="sc" id="galeria"><div class="w"><div class="st"><h2>Galeria</h2></div><div class="gal">${s.gallery.map((g) => `<figure><img src="${esc(siteImg(c.org.slug, g.id, 600))}" alt="${esc(g.caption)}" loading="lazy">${g.caption ? `<figcaption>${esc(g.caption)}</figcaption>` : ''}</figure>`).join('')}</div></div></section>` : '',
    avaliacao: () => `<section class="sc" id="avaliacao"><div class="w">${appraisal(c, appraisalToken, consent)}</div></section>`,
    contato: () => contactBlock(c),
  };
  const body = s.sections.filter((x) => x.on).map((x) => sec[x.id]?.() ?? '').join('');
  const ld = { '@context': 'https://schema.org', '@type': 'RealEstateAgent', name, url, ...(c.hasLogo ? { logo: `${c.base}/api/public/brand/${c.org.slug}/logo` } : {}), ...(s.contact.address ? { address: s.contact.address } : {}), ...(s.contact.phone ? { telephone: s.contact.phone } : {}) };
  const desc = (s.hero.subtitle || c.brand.intro || c.brand.tagline || `Imóveis disponíveis — ${name}`).slice(0, 160);
  const og = covers[0] ? `${c.base}${covers[0]}` : c.hasLogo ? `${c.base}/api/public/brand/${c.org.slug}/logo` : undefined;
  return `${head(c, { title: `${title} — Imóveis`, desc, url, img: og, ld })}${header(c, true)}<main>${hero}${cats ? `<div class="w"><nav class="cats" aria-label="Categorias">${cats}</nav></div>` : ''}${body}</main>${footer(c)}${SCRIPT(c.org.slug)}</body></html>`;
}

function contactBlock(c: SiteCtx) {
  const k = c.site.contact, wa = waLink(whats(c), `Olá! Vim pelo site da ${orgName(c)}.`);
  const items = [wa && `<a href="${esc(wa)}" rel="noopener">${ic('wa')}<span><b>WhatsApp</b><small>${esc(whats(c))}</small></span></a>`, k.phone && `<a href="tel:${esc(k.phone.replace(/[^\d+]/g, ''))}">${ic('phone')}<span><b>Telefone</b><small>${esc(k.phone)}</small></span></a>`,
    k.email && `<a href="mailto:${esc(k.email)}">${ic('mail')}<span><b>E-mail</b><small>${esc(k.email)}</small></span></a>`, k.address && `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(k.address)}" rel="noopener">${ic('pin')}<span><b>Endereço</b><small>${esc(k.address)}</small></span></a>`,
    k.hours && `<div>${ic('clock')}<span><b>Atendimento</b><small>${esc(k.hours)}</small></span></div>`].filter(Boolean);
  return items.length ? `<section class="sc" id="contato"><div class="w"><div class="st"><h2>Fale com a gente</h2></div><div class="ct">${items.join('')}</div></div></section>` : '';
}

export function renderProperty(c: SiteCtx, d: any, similar: any[], leadToken: string, consent: string) {
  const root = `/v/${encodeURIComponent(c.org.slug)}`, url = `${c.base}${root}/imovel/${d.code}`;
  const pl = [d.neighborhood, d.city && `${d.city}${d.state ? '/' + d.state : ''}`].filter(Boolean).join(', ');
  const ph = d.photos as { id: string; caption?: string }[];
  const n = Math.min(ph.length, 5);
  const gal = ph.length ? `<div class="pg n${n}">${ph.slice(0, 5).map((f, i) => `<a href="#f${i}" data-lb="f${i}"><img src="${photo(f.id, i ? 800 : 1400)}" alt="${esc(f.caption || d.title)}"${i ? ' loading="lazy"' : ''}>${i === 4 && ph.length > 5 ? `<span class="more">+${ph.length - 5} fotos</span>` : ''}</a>`).join('')}</div>
<dialog class="lb" id="lb"><button type="button">Fechar ✕</button><div class="ls">${ph.map((f, i) => `<img id="f${i}" src="${photo(f.id, 1600)}" alt="${esc(f.caption || d.title)}" loading="lazy">`).join('')}</div></dialog>` : '';
  const pr = d.prices ? (([['venda', 'Venda', ''], ['aluguel', 'Aluguel', '/mês'], ['arrendamento', 'Arrendamento', '/ano']] as const).filter(([k]) => d.prices[k] != null).map(([k, l, suf]) => `<div><span>${l}</span><b class="pr">${brl(d.prices[k])}<small>${suf}</small></b></div>`).join('')) : '';
  const kv = [d.area_total && [ic('area') + 'Área', `${Number(d.area_total).toLocaleString('pt-BR')} ${AREA[d.area_unit] ?? ''}`], d.bedrooms != null && [ic('bed') + 'Quartos', d.bedrooms], d.bathrooms != null && [ic('bath') + 'Banheiros', d.bathrooms], d.parking != null && [ic('car') + 'Vagas', d.parking], [ic('pin') + 'Tipo', subLabel(d.subtype)]].filter(Boolean) as [string, string][];
  const wa = waLink(whats(c), `Olá! Tenho interesse no imóvel "${d.title}" (${url})`);
  const videos = (d.videos ?? []) as any[];
  const extra = [d.rural && d.rural.water_sources.length && `Água: ${d.rural.water_sources.join(', ')}`, d.rural && d.rural.activities.length && `Atividades: ${d.rural.activities.join(', ')}`, d.coastal?.beach_distance_m != null && `A ${d.coastal.beach_distance_m} m da praia${d.coastal.sea_view ? ' · vista para o mar' : ''}`].filter(Boolean) as string[];
  const desc = (d.description || `${d.title} — ${pl}`).replace(/\s+/g, ' ').slice(0, 160);
  const ld = { '@context': 'https://schema.org', '@type': 'RealEstateListing', name: d.title, description: desc, url, ...(ph[0] ? { image: `${c.base}${photo(ph[0].id, 1200)}` } : {}) };
  return `${head(c, { title: `${d.title} — ${orgName(c)}`, desc, url, img: ph[0] ? `${c.base}${photo(ph[0].id, 1200)}` : undefined, ld })}${header(c, false)}<main class="w">
<div class="crumb"><a href="${root}#imoveis">← Todos os imóveis</a></div>${gal}
<div class="dt"><div><div class="tags">${d.purposes.map((x: string) => `<span>${esc(FIN[x] ?? x)}</span>`).join('')}<span>${esc(d.kind === 'rural' ? 'Rural' : 'Urbano')}</span></div>
<h1 style="margin-top:12px">${esc(d.title)}</h1><div class="loc" style="margin-top:6px">${ic('pin')}${esc(pl)}${d.street ? ` — ${esc(d.street)}` : ''}</div>
${d.status !== 'disponivel' ? '<p class="warn">Este imóvel pode não estar mais disponível. Fale com a imobiliária para confirmar.</p>' : ''}
<div class="kv">${kv.map(([k, v]) => `<div><small>${k}</small><b>${esc(v)}</b></div>`).join('')}</div>
${d.description ? `<div class="box"><h2>Descrição</h2><p>${esc(d.description)}</p></div>` : ''}
${d.features.length ? `<div class="box"><h2>Características</h2><div class="tags">${d.features.map((x: string) => `<span>${esc(x)}</span>`).join('')}</div></div>` : ''}
${extra.length ? `<div class="box"><h2>Detalhes</h2><p>${esc(extra.join('\n'))}</p></div>` : ''}
${videos.length ? `<div class="box"><h2>Vídeo${videos.length > 1 ? 's' : ''}</h2><div class="vds">${videos.map((v) => `<div class="vd"><div class="fr"><iframe src="${esc(embedUrl(v))}" title="${esc(v.title || d.title)}" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>${v.title ? `<b>${esc(v.title)}</b>` : ''}</div>`).join('')}</div></div>` : ''}
${pl ? `<div class="box"><h2>Localização</h2><p>${esc(pl)}</p><p style="margin-top:8px"><a class="lnk" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pl)}" rel="noopener">Ver região no mapa →</a></p></div>` : ''}
</div><aside class="ask box" style="margin-top:0">${pr ? `<div class="pl">${pr}</div>` : '<div class="pr c" style="margin-bottom:12px">Valor sob consulta</div>'}
${wa ? `<a class="btn wa" href="${esc(wa)}" rel="noopener" style="margin-bottom:16px">${ic('wa')} Conversar no WhatsApp</a>` : ''}<h2>Tenho interesse</h2>
<form class="fm" id="lf" novalidate data-code="${esc(d.code)}" data-token="${esc(leadToken)}"><label>Seu nome<input name="name" required maxlength="120" autocomplete="name"></label><label>Telefone com DDD<input name="phone" inputmode="tel" autocomplete="tel"></label><label>E-mail<input name="email" type="email" autocomplete="email"></label>
<label>Mensagem<textarea name="message" rows="3" maxlength="1000">Olá! Gostaria de mais informações sobre este imóvel.</textarea></label><div class="hp" aria-hidden="true"><label>Site<input name="website" tabindex="-1" autocomplete="off"></label></div>
<label class="ck"><input type="checkbox" name="consent"> <span>${esc(consent)}</span></label><button class="btn" type="submit">Enviar</button><p role="status"></p></form></aside></div>
${similar.length ? `<section class="sc"><div class="st"><h2>Você também pode gostar</h2></div><div class="grid">${similar.map((p) => propCard(c, p)).join('')}</div></section>` : ''}
</main>${footer(c)}${SCRIPT(c.org.slug)}</body></html>`;
}

export { SECTION_LABEL };
