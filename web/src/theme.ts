/** Aplica a aparência do app (definida pela imobiliária) como variáveis CSS. */
export type AppTheme = {
  source: 'site' | 'proprio'; primary: string; accent: string; bg: string; text: string;
  font: 'moderna' | 'classica' | 'elegante'; radius: 'reto' | 'suave' | 'redondo'; nav: 'claro' | 'escuro' | 'cor';
  cards: 'grade' | 'lista'; banner: boolean; banner_image: string; banner_url?: string | null;
};
export const DEFAULT_THEME: AppTheme = { source: 'proprio', primary: '#0f766e', accent: '#f59e0b', bg: '#f3f5f8', text: '#0f172a', font: 'moderna', radius: 'suave', nav: 'claro', cards: 'grade', banner: true, banner_image: '' };

const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0); };
export const onColor = (hex: string) => (lum(hex) > 0.4 ? '#0f172a' : '#ffffff');
export const isDark = (hex: string) => lum(hex) < 0.18;

const FONTS = { moderna: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", classica: "Georgia, 'Times New Roman', serif", elegante: "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif" };
const RADII = { reto: ['6px', '4px'], suave: ['14px', '10px'], redondo: ['22px', '16px'] };
const VARS = ['--brand', '--brand-2', '--brand-ink', '--brand-soft', '--brand-text', '--accent', '--accent-ink', '--bg', '--card', '--ink', '--muted', '--line', '--line-2', '--radius', '--radius-sm', '--font-h', '--side-bg', '--side-ink', '--side-soft', '--side-active', '--side-active-ink', '--side-muted', '--warn', '--warn-soft', '--danger', '--danger-soft', '--ok', '--ok-soft', '--shadow', '--shadow-lg'];

/** Tema padrão sem personalização: deixa o CSS cuidar (inclui modo escuro automático do aparelho). */
const isDefault = (t: AppTheme) => t.source === 'proprio' && (['primary', 'accent', 'bg', 'text', 'font', 'radius', 'nav'] as const).every((k) => t[k] === DEFAULT_THEME[k]);

export function applyTheme(t: AppTheme | null | undefined) {
  const el = document.documentElement; const st = el.style;
  VARS.forEach((v) => st.removeProperty(v));
  const th = { ...DEFAULT_THEME, ...(t ?? {}) };
  el.dataset.cards = th.cards; el.dataset.nav = th.nav; el.dataset.font = th.font;
  if (isDefault(th)) { delete el.dataset.themed; el.style.colorScheme = ''; setMeta(th.primary); return; }
  const dark = isDark(th.bg);
  const card = dark ? `color-mix(in srgb, ${th.bg} 86%, #ffffff)` : '#ffffff';
  const set = (k: string, v: string) => st.setProperty(k, v);
  set('--brand', th.primary); set('--brand-2', `color-mix(in srgb, ${th.primary} 78%, #ffffff)`); set('--brand-ink', onColor(th.primary));
  set('--brand-soft', `color-mix(in srgb, ${th.primary} ${dark ? 24 : 11}%, ${card})`);
  set('--brand-text', dark ? `color-mix(in srgb, ${th.primary} 50%, #ffffff)` : th.primary);
  set('--accent', th.accent); set('--accent-ink', onColor(th.accent));
  set('--bg', th.bg); set('--card', card); set('--ink', th.text);
  set('--muted', `color-mix(in srgb, ${th.text} 62%, ${th.bg})`); set('--line', `color-mix(in srgb, ${th.text} 12%, transparent)`); set('--line-2', `color-mix(in srgb, ${th.text} 20%, transparent)`);
  // cores de aviso coerentes com o fundo escolhido (não com o modo do aparelho)
  if (dark) { set('--warn', '#fbbf24'); set('--warn-soft', 'rgb(251 191 36 / .14)'); set('--danger', '#f87171'); set('--danger-soft', 'rgb(248 113 113 / .14)'); set('--ok', '#4ade80'); set('--ok-soft', 'rgb(74 222 128 / .14)'); set('--shadow', '0 1px 2px #0006'); set('--shadow-lg', '0 16px 48px #000a'); }
  else { set('--warn', '#b45309'); set('--warn-soft', '#fef3c7'); set('--danger', '#b91c1c'); set('--danger-soft', '#fee2e2'); set('--ok', '#15803d'); set('--ok-soft', '#dcfce7'); set('--shadow', '0 1px 2px rgb(15 23 42 / .05), 0 1px 3px rgb(15 23 42 / .06)'); set('--shadow-lg', '0 12px 40px rgb(15 23 42 / .16)'); }
  const [r, rs] = RADII[th.radius]; set('--radius', r); set('--radius-sm', rs); set('--font-h', FONTS[th.font]);
  if (th.nav === 'escuro') { set('--side-bg', '#0f172a'); set('--side-ink', '#e2e8f0'); set('--side-muted', '#94a3b8'); set('--side-soft', 'rgb(255 255 255 / .07)'); set('--side-active', 'rgb(255 255 255 / .12)'); set('--side-active-ink', '#ffffff'); }
  else if (th.nav === 'cor') { const ink = onColor(th.primary); set('--side-bg', th.primary); set('--side-ink', ink); set('--side-muted', `color-mix(in srgb, ${ink} 70%, ${th.primary})`); set('--side-soft', `color-mix(in srgb, ${ink} 10%, transparent)`); set('--side-active', `color-mix(in srgb, ${ink} 18%, transparent)`); set('--side-active-ink', ink); }
  el.dataset.themed = '1'; el.style.colorScheme = dark ? 'dark' : 'light';
  setMeta(th.nav === 'cor' ? th.primary : dark ? th.bg : th.primary);
}
function setMeta(c: string) { document.querySelectorAll('meta[name=theme-color]').forEach((m) => m.setAttribute('content', c)); }
