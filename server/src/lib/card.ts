import QRCode from 'qrcode';
import { escXml, onColor, type Brand } from './brand.js';

export interface CardData { orgName: string; brand: Brand; logo?: string | null; name: string; title?: string; phone?: string; whatsapp?: string; email?: string; creci?: string; url: string; services?: string[]; headline?: 'imobiliaria' | 'corretor' }
const W = 1063, H = 591; // 90 x 50 mm a 300 dpi
const FONT = "font-family=\"Inter, 'DejaVu Sans', Arial, sans-serif\"";
const fit = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + '…' : s);
const size = (s: string, base: number, ok: number) => (s.length <= ok ? base : Math.max(base * 0.6, base * ok / s.length));

export function qrSvgPaths(text: string, x: number, y: number, box: number, color = '#000') {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' }); const n = qr.modules.size; const cell = box / n;
  let d = ''; for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.modules.data[r * n + c]) d += `M${(x + c * cell).toFixed(2)} ${(y + r * cell).toFixed(2)}h${cell.toFixed(2)}v${cell.toFixed(2)}h-${cell.toFixed(2)}z`;
  return `<path d="${d}" fill="${color}"/>`;
}
export const plainQrSvg = (text: string, color = '#111827') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" shape-rendering="crispEdges"><rect width="300" height="300" fill="#fff"/>${qrSvgPaths(text, 20, 20, 260, color)}</svg>`;

export function renderCard(side: 'front' | 'back', layout: Brand['card_layout'], d: CardData): string {
  const P = d.brand.primary, S = d.brand.secondary;
  const shortUrl = d.url.replace(/^https?:\/\//, '').replace(/\?.*$/, '').replace(/\/$/, '');
  const logo = (x: number, y: number, w: number, h: number) => d.logo ? `<image href="${d.logo}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>` : `<text x="${x}" y="${y + h * 0.7}" ${FONT} font-size="${Math.min(46, h * 0.6)}" font-weight="800">${escXml(fit(d.orgName, 22))}</text>`;
  const contacts = (x: number, y: number, fg: string, gap = 50) => [d.phone && `Tel  ${d.phone}`, d.whatsapp && `WhatsApp  ${d.whatsapp}`, d.email && d.email, d.creci && `CRECI ${d.creci}`].filter(Boolean).slice(0, 4).map((t, i) => `<text x="${x}" y="${y + i * gap}" ${FONT} font-size="${size(String(t), 30, 34)}" fill="${fg}">${escXml(fit(String(t), 40))}</text>`).join('');
  const head = (body: string, bg: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${bg}"/>${body}</svg>`;

  if (side === 'back') {
    const bg = layout === 'moderno' ? P : '#ffffff', fg = layout === 'moderno' ? onColor(P) : '#111827';
    const box = 330, x = (W - box) / 2 - (layout === 'minimal' ? 0 : 200), y = (H - box) / 2;
    return head(`
      ${layout === 'classico' ? `<rect x="0" y="0" width="${W}" height="26" fill="${P}"/><rect x="0" y="${H - 26}" width="${W}" height="26" fill="${S}"/>` : ''}
      <rect x="${x - 24}" y="${y - 24}" width="${box + 48}" height="${box + 48}" rx="26" fill="#fff" stroke="${layout === 'minimal' ? '#e5e7eb' : 'none'}" stroke-width="3"/>
      ${qrSvgPaths(d.url, x, y, box, layout === 'moderno' ? '#111827' : P)}
      <g fill="${fg}"><text x="${layout === 'minimal' ? W / 2 : x + box + 70}" y="${layout === 'minimal' ? y + box + 80 : 250}" ${FONT} font-size="46" font-weight="800" ${layout === 'minimal' ? 'text-anchor="middle"' : ''}>Veja nossos imóveis</text>
      <text x="${layout === 'minimal' ? W / 2 : x + box + 70}" y="${layout === 'minimal' ? y + box + 128 : 305}" ${FONT} font-size="${size(shortUrl, 32, 30)}" ${layout === 'minimal' ? 'text-anchor="middle"' : ''}>${escXml(fit(shortUrl, 46))}</text>
      ${layout !== 'minimal' ? `<text x="${x + box + 70}" y="360" ${FONT} font-size="28" opacity=".8">Aponte a câmera para o QR Code</text>` : ''}</g>`, bg);
  }
  return renderFront(layout, d);
}

/** Frente do cartão: logomarca, nome em destaque, contatos, serviços em coluna, botão "Clique aqui" e QR Code da vitrine. Tudo editável pela imobiliária (brand.card). */
function renderFront(layout: Brand['card_layout'], d: CardData): string {
  const P = d.brand.primary, C = d.brand.card;
  const mod = layout === 'moderno', min = layout === 'minimal';
  const bg = C.bg || (mod ? P : '#ffffff');
  const dark = onColor(bg) === '#ffffff';
  const fg = C.fg || onColor(bg);
  const S = C.accent || d.brand.secondary;
  const subc = dark ? fg : P, head = dark ? fg : P;
  const corretor = (d.headline ?? 'imobiliaria') === 'corretor';
  const big = C.headline_text || (corretor ? d.name : d.orgName);
  const sub = C.sub_text || (corretor ? [d.title || 'Corretor de imóveis', d.orgName].join(' · ') : [d.name, d.title].filter(Boolean).join(' · '));
  const services = (d.services ?? []).filter(Boolean).slice(0, 5);
  const auto = [d.phone && `Tel  ${d.phone}`, d.whatsapp && `WhatsApp  ${d.whatsapp}`, d.email, d.creci && `CRECI ${d.creci}`];
  const lines = ((C.contacts ?? []).filter(Boolean).length ? C.contacts : auto).filter(Boolean).slice(0, 4) as string[];
  const logoBox = dark ? `<rect x="60" y="44" width="300" height="120" rx="22" fill="#fff"/>` : '';
  const logo = d.logo ? `<image href="${d.logo}" x="${mod ? 74 : 70}" y="${mod ? 52 : 50}" width="${mod ? 272 : 290}" height="${mod ? 104 : 110}" preserveAspectRatio="xMinYMid meet"/>` : `<text x="70" y="120" ${FONT} font-size="46" font-weight="800" fill="${dark ? fg : P}">${escXml(fit(d.orgName, 20))}</text>`;
  const px = 600, pw = 413, py = 50, ph = 491;
  const panel = dark ? `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="28" fill="#fff" fill-opacity=".14"/>` : min ? `<rect x="580" y="60" width="3" height="${ph - 20}" fill="${S}"/>` : `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="28" fill="${P}" fill-opacity=".08" stroke="${P}" stroke-opacity=".25" stroke-width="2"/>`;
  const tx = min ? 630 : 634;
  const sfs = Math.max(18, Math.min(29, 330 / (Math.max(1, ...services.map((t) => t.length)) * 0.52)));
  const items = services.map((t, i) => `<circle cx="${tx + 8}" cy="${160 + i * 52 - 9}" r="8" fill="${S}"/><text x="${tx + 32}" y="${160 + i * 52}" ${FONT} font-size="${sfs.toFixed(1)}" fill="${fg}">${escXml(fit(t, 34))}</text>`).join('');
  const qx = 868, qy = 408, qb = 112;
  const bands = layout === 'classico' ? `<rect x="0" y="0" width="34" height="${H}" fill="${P}"/><rect x="34" y="0" width="10" height="${H}" fill="${S}"/>` : mod ? `<rect x="0" y="${H - 28}" width="${W}" height="28" fill="${S}"/>` : '';
  const left = layout === 'classico' ? 96 : 70;
  const contacts = lines.map((t, i) => `<text x="${left}" y="${416 + i * 38}" ${FONT} font-size="${size(t, 26, 34)}" fill="${fg}" fill-opacity=".9">${escXml(fit(t, 42))}</text>`).join('');
  const label = (C.button_label || 'Clique aqui').toUpperCase();
  const bw = 200, bh = 54, bx = tx, by = qy + 6;
  const button = `<a href="${escXml(d.url)}"><rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="27" fill="${S}"/><text x="${bx + bw / 2}" y="${by + 36}" text-anchor="middle" ${FONT} font-size="${size(label, 24, 12)}" font-weight="800" fill="${onColor(S)}">${escXml(fit(label, 18))}</text></a>`;
  const body = `${bands}<g transform="translate(${layout === 'classico' ? 26 : 0},0)">${logoBox}${logo}</g>
    <text x="${left}" y="262" ${FONT} font-size="${size(big, 54, 18)}" font-weight="800" fill="${fg}">${escXml(fit(big, 30))}</text>
    <text x="${left}" y="306" ${FONT} font-size="${size(sub, 27, 36)}" fill="${subc}" ${dark ? 'fill-opacity=".9"' : 'font-weight="600"'}>${escXml(fit(sub, 48))}</text>
    ${contacts}
    ${panel}
    <text x="${tx}" y="112" ${FONT} font-size="30" font-weight="800" fill="${head}" letter-spacing="1">${escXml(fit((C.services_title || 'Nossos serviços').toUpperCase(), 22))}</text>
    ${items}
    <rect x="${qx - 12}" y="${qy - 12}" width="${qb + 24}" height="${qb + 24}" rx="16" fill="#fff" stroke="${dark ? 'none' : '#e5e7eb'}" stroke-width="2"/>
    ${qrSvgPaths(d.url, qx, qy, qb, dark ? '#111827' : P)}
    ${button}
    <text x="${tx}" y="${by + bh + 34}" ${FONT} font-size="20" fill="${fg}" fill-opacity=".85">ou aponte a câmera ›</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${bg}"/>${body}</svg>`;
}
