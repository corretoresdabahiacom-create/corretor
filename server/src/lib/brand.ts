export type CardCustom = { bg: string; fg: string; accent: string; headline_text: string; sub_text: string; services_title: string; button_label: string; contacts: string[] };
export type Brand = { primary: string; secondary: string; tagline: string; title: string; intro: string; layout: 'grade' | 'lista'; card_layout: 'classico' | 'moderno' | 'minimal'; services: string[]; card: CardCustom };
export const DEFAULT_BRAND: Brand = { primary: '#0f766e', secondary: '#f59e0b', tagline: '', title: '', intro: '', layout: 'grade', card_layout: 'classico', services: ['Vendas, aluguel e arrendamentos', 'Imóveis urbanos, rurais e litorais', 'Avaliação de imóveis'], card: { bg: '', fg: '', accent: '', headline_text: '', sub_text: '', services_title: '', button_label: '', contacts: [] } };
export const HEX = /^#[0-9a-fA-F]{6}$/;
export const brandOf = (raw: any): Brand => ({ ...DEFAULT_BRAND, ...(raw ?? {}), card: { ...DEFAULT_BRAND.card, ...(raw?.card ?? {}) } });
/** Cor de texto legível (branco/preto) sobre um fundo. */
export function onColor(hex: string) {
  const n = parseInt(hex.slice(1), 16); const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#111827' : '#ffffff';
}
export const escXml = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
