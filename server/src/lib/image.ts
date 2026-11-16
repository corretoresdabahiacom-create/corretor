// Processamento de imagens com duas implementações:
//  - Node: usa `sharp` (redimensiona, converte, remove metadados).
//  - Cloudflare Workers (sem módulos nativos): valida o tipo, remove metadados EXIF/GPS de JPEG e devolve a imagem
//    original; o app web já reduz e reencoda as fotos antes de enviar (web/src/lib/image.ts).
import { sniffMime } from './storage.js';

let sharp: any = null;
try { sharp = (await import('sharp')).default; } catch { sharp = null; }
export const hasSharp = !!sharp;

export type Img = { data: Buffer; mime: 'image/jpeg' | 'image/png' | 'image/webp'; width: number; height: number };

/** Remove segmentos de metadados (EXIF/XMP/IPTC/comentários) de um JPEG, mantendo perfil de cor (APP2) e demais. */
export function stripJpeg(b: Buffer): Buffer {
  if (b[0] !== 0xff || b[1] !== 0xd8) return b;
  const out: Buffer[] = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) break;
    const m = b[i + 1];
    if (m === 0xd9 || m === 0xda) break; // fim / início dos dados da imagem
    if (m === 0xff) { i++; continue; }
    const len = b.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > b.length) return b; // estrutura inesperada: não mexe
    const seg = b.subarray(i, i + 2 + len);
    const drop = m === 0xe1 || m === 0xed || m === 0xfe; // APP1 (EXIF/XMP), APP13 (IPTC), COM
    if (!drop) out.push(seg);
    i += 2 + len;
  }
  out.push(b.subarray(i));
  return Buffer.concat(out);
}

/** Largura e altura sem decodificar (JPEG, PNG, WebP). */
export function dimensions(b: Buffer): { width: number; height: number } | null {
  try {
    if (b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
        i += 2 + b.readUInt16BE(i + 2);
      }
      return null;
    }
    if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
      const t = b.toString('latin1', 12, 16);
      if (t === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
      if (t === 'VP8L') { const v = b.readUInt32LE(21); return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
      if (t === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    }
  } catch { /* cai no null */ }
  return null;
}

/** Valida e normaliza uma imagem enviada. `maxSide` limita o maior lado (só quando há sharp). */
export async function normalize(raw: Buffer, opts: { maxSide: number; format: 'jpeg' | 'png' }): Promise<Img | null> {
  if (sharp) {
    const base = sharp(raw).rotate().resize({ width: opts.maxSide, height: opts.maxSide, fit: 'inside', withoutEnlargement: true });
    const o = await (opts.format === 'jpeg' ? base.jpeg({ quality: 84, mozjpeg: true }) : base.png()).toBuffer({ resolveWithObject: true }).catch(() => null);
    return o ? { data: o.data, mime: opts.format === 'jpeg' ? 'image/jpeg' : 'image/png', width: o.info.width, height: o.info.height } : null;
  }
  const mime = sniffMime(raw);
  if (!mime || mime === 'application/pdf') return null;
  const d = dimensions(raw);
  if (!d || !d.width || !d.height || d.width > 12000 || d.height > 12000) return null;
  return { data: mime === 'image/jpeg' ? stripJpeg(raw) : raw, mime, ...d };
}

/** Miniatura WebP; sem sharp devolve a própria imagem (o navegador a reduz). */
export async function thumb(data: Buffer, width: number, quality: number, rotate = true): Promise<{ data: Buffer; mime: string }> {
  if (sharp) {
    const o = await (rotate ? sharp(data).rotate() : sharp(data)).resize({ width, withoutEnlargement: true }).webp({ quality }).toBuffer().catch(() => null);
    if (o) return { data: o, mime: 'image/webp' };
  }
  return { data, mime: sniffMime(data) ?? 'application/octet-stream' };
}

/** SVG → PNG (só com sharp). Sem sharp, retorna null e a rota responde com o SVG. */
export async function svgToPng(svg: string): Promise<Buffer | null> {
  return sharp ? sharp(Buffer.from(svg)).png().toBuffer() : null;
}
