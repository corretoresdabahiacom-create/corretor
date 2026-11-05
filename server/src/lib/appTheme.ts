import { z } from 'zod';
import { HEX, brandOf } from './brand.js';
import { siteOf } from './site.js';

/** Aparência do app da equipe. "Igual ao site" copia cores, letras e cantos do site da vitrine. */
export type AppTheme = {
  source: 'site' | 'proprio';
  primary: string; accent: string; bg: string; text: string;
  font: 'moderna' | 'classica' | 'elegante'; radius: 'reto' | 'suave' | 'redondo';
  nav: 'claro' | 'escuro' | 'cor'; cards: 'grade' | 'lista'; banner: boolean; banner_image: string;
};
export const DEFAULT_APP_THEME: AppTheme = { source: 'proprio', primary: '#0f766e', accent: '#f59e0b', bg: '#f3f5f8', text: '#0f172a', font: 'moderna', radius: 'suave', nav: 'claro', cards: 'grade', banner: true, banner_image: '' };

const hex = z.string().regex(HEX, 'Cor inválida. Use o formato #RRGGBB.');
export const appThemeInput = z.object({
  source: z.enum(['site', 'proprio']), primary: hex, accent: hex, bg: hex, text: hex,
  font: z.enum(['moderna', 'classica', 'elegante']), radius: z.enum(['reto', 'suave', 'redondo']),
  nav: z.enum(['claro', 'escuro', 'cor']), cards: z.enum(['grade', 'lista']), banner: z.boolean(), banner_image: z.string().uuid().or(z.literal('')),
}).partial();

/** Tema salvo (o que o editor mostra). */
export const appThemeOf = (raw: any): AppTheme => ({ ...DEFAULT_APP_THEME, ...(raw ?? {}) });

/** Tema efetivo (o que o app aplica): com "igual ao site", cores/letras/cantos vêm do site e da marca. */
export function effectiveTheme(org: { app_theme: any; site: any; brand: any; slug: string }) {
  const t = appThemeOf(org.app_theme);
  const out = { ...t };
  if (t.source === 'site') {
    const b = brandOf(org.brand), s = siteOf(org.site, b.layout);
    Object.assign(out, { primary: b.primary, accent: b.secondary, bg: s.theme.bg, text: s.theme.text, font: s.theme.font, radius: s.theme.radius, nav: s.theme.header, cards: s.theme.cards });
    if (!t.banner_image && s.hero.images[0]) out.banner_image = s.hero.images[0];
  }
  return { ...out, banner_url: out.banner_image ? `/api/public/site/${org.slug}/img/${out.banner_image}?w=1600` : null };
}
