import { z } from 'zod';
import { HEX } from './brand.js';

/** Configuração do site da vitrine, editável pela imobiliária. Tudo opcional: o que faltar usa o padrão. */
export const SECTION_IDS = ['destaques', 'imoveis', 'servicos', 'sobre', 'videos', 'galeria', 'avaliacao', 'mapa', 'contato'] as const;
export type SectionId = (typeof SECTION_IDS)[number];
export const SECTION_LABEL: Record<SectionId, string> = {
  destaques: 'Destaques', imoveis: 'Imóveis', servicos: 'Serviços', sobre: 'Sobre nós', videos: 'Vídeos', galeria: 'Galeria de fotos', avaliacao: 'Avaliação de imóveis', mapa: 'Mapa dos imóveis', contato: 'Contato',
};

export type Video = { provider: 'youtube' | 'vimeo'; id: string; title: string };
export type Site = {
  theme: { bg: string; text: string; header: 'claro' | 'escuro' | 'cor'; font: 'moderna' | 'classica' | 'elegante'; radius: 'reto' | 'suave' | 'redondo'; hero: 'imagem' | 'cor' | 'dividido'; cards: 'grade' | 'lista' };
  hero: { title: string; subtitle: string; images: string[] };
  about: { title: string; text: string; image: string };
  contact: { address: string; phone: string; email: string; whatsapp: string; instagram: string; facebook: string; hours: string };
  videos: Video[];
  gallery: { id: string; caption: string }[];
  sections: { id: SectionId; on: boolean }[];
  footer: string;
};

export const DEFAULT_SITE: Site = {
  theme: { bg: '#f6f7f9', text: '#1f2937', header: 'claro', font: 'moderna', radius: 'suave', hero: 'imagem', cards: 'grade' },
  hero: { title: '', subtitle: '', images: [] },
  about: { title: 'Sobre nós', text: '', image: '' },
  contact: { address: '', phone: '', email: '', whatsapp: '', instagram: '', facebook: '', hours: '' },
  videos: [], gallery: [],
  sections: SECTION_IDS.map((id) => ({ id, on: true })),
  footer: '',
};

/** Mescla o que está salvo com o padrão; seções desconhecidas são descartadas e as que faltam entram no fim. */
export function siteOf(raw: any, legacyLayout?: string): Site {
  const r = raw ?? {};
  const theme = { ...DEFAULT_SITE.theme, ...(legacyLayout === 'lista' ? { cards: 'lista' as const } : {}), ...(r.theme ?? {}) };
  const seen = new Set<string>();
  const sections = [...(Array.isArray(r.sections) ? r.sections : []), ...DEFAULT_SITE.sections]
    .filter((s: any) => SECTION_IDS.includes(s?.id) && !seen.has(s.id) && seen.add(s.id))
    .map((s: any) => ({ id: s.id as SectionId, on: s.on !== false }));
  return {
    theme, sections,
    hero: { ...DEFAULT_SITE.hero, ...(r.hero ?? {}) }, about: { ...DEFAULT_SITE.about, ...(r.about ?? {}) }, contact: { ...DEFAULT_SITE.contact, ...(r.contact ?? {}) },
    videos: Array.isArray(r.videos) ? r.videos : [], gallery: Array.isArray(r.gallery) ? r.gallery : [], footer: typeof r.footer === 'string' ? r.footer : '',
  };
}

const YT = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be']);
const VM = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com']);
/** Aceita só links do YouTube e do Vimeo. Guarda apenas o provedor e o ID (nunca o link cru). */
export function parseVideo(url: string): { provider: 'youtube' | 'vimeo'; id: string } | null {
  let u: URL; try { u = new URL(url.trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const h = u.hostname.toLowerCase();
  if (YT.has(h)) {
    const id = h.endsWith('youtu.be') ? u.pathname.slice(1) : u.searchParams.get('v') ?? (u.pathname.match(/^\/(?:embed|shorts|live)\/([^/?#]+)/)?.[1] ?? '');
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? { provider: 'youtube', id } : null;
  }
  if (VM.has(h)) { const id = u.pathname.match(/^\/(?:video\/)?(\d{6,12})(?:\/|$)/)?.[1]; return id ? { provider: 'vimeo', id } : null; }
  return null;
}
export const embedUrl = (v: { provider: string; id: string }) => v.provider === 'youtube' ? `https://www.youtube-nocookie.com/embed/${v.id}` : `https://player.vimeo.com/video/${v.id}?dnt=1`;
export const VIDEO_FRAME_SRC = ['https://www.youtube-nocookie.com', 'https://player.vimeo.com'];

const videoIn = z.object({ url: z.string().trim().max(300), title: z.string().trim().max(80).default('') });
export const videosInput = z.array(videoIn).max(10, 'No máximo 10 vídeos.').transform((list, ctx) => {
  const out: Video[] = [];
  list.forEach((v, i) => { const p = parseVideo(v.url); if (!p) ctx.addIssue({ code: 'custom', path: [i, 'url'], message: 'Use um link do YouTube ou do Vimeo.' }); else out.push({ ...p, title: v.title }); });
  return out;
});

const hexOr = z.string().regex(HEX, 'Cor inválida. Use o formato #RRGGBB.');
const txt = (n: number) => z.string().trim().max(n);
const uuid = z.string().uuid();
/** Validação do PATCH /api/site (parcial: cada bloco enviado substitui o bloco salvo). */
export const siteInput = z.object({
  theme: z.object({ bg: hexOr, text: hexOr, header: z.enum(['claro', 'escuro', 'cor']), font: z.enum(['moderna', 'classica', 'elegante']), radius: z.enum(['reto', 'suave', 'redondo']), hero: z.enum(['imagem', 'cor', 'dividido']), cards: z.enum(['grade', 'lista']) }).partial(),
  hero: z.object({ title: txt(80), subtitle: txt(160), images: z.array(uuid).max(6, 'No máximo 6 fotos de capa.') }).partial(),
  about: z.object({ title: txt(60), text: txt(2000), image: uuid.or(z.literal('')) }).partial(),
  contact: z.object({ address: txt(160), phone: txt(30), email: z.string().trim().max(120).email('E-mail inválido.').or(z.literal('')), whatsapp: txt(30), instagram: txt(60), facebook: txt(80), hours: txt(120) }).partial(),
  videos: videosInput,
  gallery: z.array(z.object({ id: uuid, caption: txt(120).default('') })).max(30, 'No máximo 30 fotos na galeria.'),
  sections: z.array(z.object({ id: z.enum(SECTION_IDS), on: z.boolean() })).max(SECTION_IDS.length),
  footer: txt(300),
}).partial();

/** Instagram/Facebook: aceita @usuario ou link e sempre gera um link https para o domínio oficial. */
export function socialUrl(kind: 'instagram' | 'facebook', v: string): string | null {
  const s = v.trim(); if (!s) return null;
  const host = kind === 'instagram' ? 'instagram.com' : 'facebook.com';
  const m = s.match(new RegExp(`^(?:https?://)?(?:www\\.)?${host.replace('.', '\\.')}/([A-Za-z0-9_.-]{1,60})/?$`)) ?? s.match(/^@?([A-Za-z0-9_.-]{1,60})$/);
  return m ? `https://www.${host}/${m[1]}` : null;
}

// ---------- filtros da lista de imóveis (usados no servidor; links compartilháveis) ----------
export type Filters = { fin?: 'venda' | 'aluguel' | 'temporada' | 'arrendamento'; tipo?: string; cidade?: string; zona?: 'urbano' | 'rural' | 'litoral'; min?: number; max?: number; quartos?: number; vagas?: number; area?: number; q?: string; ordem: 'recentes' | 'menor' | 'maior' | 'area' };
const num = (v: unknown, lo = 0, hi = 1e10) => { const d = String(v ?? '').split(',')[0].replace(/\D/g, ''); const n = Number(d); return d && Number.isFinite(n) && n >= lo && n <= hi ? n : undefined; };
export function parseFilters(qy: any): Filters {
  const s = (v: unknown, n = 80) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined);
  const fin = s(qy.fin); const zona = s(qy.zona); const ordem = s(qy.ordem);
  return {
    fin: ['venda', 'aluguel', 'temporada', 'arrendamento'].includes(fin!) ? (fin as Filters['fin']) : undefined,
    tipo: s(qy.tipo, 40)?.match(/^[a-z_]+$/) ? s(qy.tipo, 40) : undefined, cidade: s(qy.cidade),
    zona: ['urbano', 'rural', 'litoral'].includes(zona!) ? (zona as Filters['zona']) : undefined,
    min: num(qy.min), max: num(qy.max), quartos: num(qy.quartos, 0, 20), vagas: num(qy.vagas, 0, 20), area: num(qy.area),
    q: s(qy.q, 60), ordem: (['recentes', 'menor', 'maior', 'area'].includes(ordem!) ? ordem : 'recentes') as Filters['ordem'],
  };
}
export const hasFilters = (f: Filters) => Object.entries(f).some(([k, v]) => k !== 'ordem' && v !== undefined) || f.ordem !== 'recentes';

/** Preço que importa para a finalidade escolhida (ou o primeiro disponível). Preço oculto = sem preço. */
export function priceFor(p: any, fin?: Filters['fin']): number | null {
  if (!p.show_price) return null;
  const by: Record<string, any> = { venda: p.price_sale, aluguel: p.price_rent, temporada: p.price_rent, arrendamento: p.price_lease };
  const v = fin ? by[fin] : p.price_sale ?? p.price_rent ?? p.price_lease;
  return v == null ? null : Number(v);
}
const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function filterProps<T extends Record<string, any>>(rows: T[], f: Filters): T[] {
  const out = rows.filter((p) => {
    if (f.fin && !p.purposes.includes(f.fin)) return false;
    if (f.tipo && p.subtype !== f.tipo) return false;
    if (f.cidade && norm(p.city) !== norm(f.cidade)) return false;
    if (f.zona === 'litoral' && !(p.location_tags ?? []).includes('litoral')) return false;
    if ((f.zona === 'urbano' || f.zona === 'rural') && p.kind !== f.zona) return false;
    if (f.min != null || f.max != null) { const pr = priceFor(p, f.fin); if (pr == null || (f.min != null && pr < f.min) || (f.max != null && pr > f.max)) return false; }
    if (f.quartos != null && !(Number(p.bedrooms ?? -1) >= f.quartos)) return false;
    if (f.vagas != null && !(Number(p.parking ?? -1) >= f.vagas)) return false;
    if (f.area != null && !(Number(p.area_total ?? -1) >= f.area)) return false;
    if (f.q) { const hay = norm([p.title, p.description, p.neighborhood, p.city, p.subtype, ...(p.features ?? [])].join(' ')); if (!norm(f.q).split(/\s+/).every((w) => hay.includes(w))) return false; }
    return true;
  });
  const pr = (p: T) => priceFor(p, f.fin);
  if (f.ordem === 'menor') out.sort((a, b) => (pr(a) ?? Infinity) - (pr(b) ?? Infinity));
  if (f.ordem === 'maior') out.sort((a, b) => (pr(b) ?? -1) - (pr(a) ?? -1));
  if (f.ordem === 'area') out.sort((a, b) => Number(b.area_total ?? -1) - Number(a.area_total ?? -1));
  return out;
}
