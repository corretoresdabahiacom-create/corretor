import { describe, it, expect, beforeAll } from 'vitest';
import sharp from 'sharp';
import { newApp, newOrg, addUser, uniq } from './helpers.js';
import { parseVideo, filterProps, parseFilters, socialUrl } from '../src/lib/site.js';

let app: any;
beforeAll(async () => { app = await newApp(); });

async function mpUpload(c: any, url: string, file: Buffer) {
  const b = '----s' + uniq();
  const payload = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: application/octet-stream\r\n\r\n`), file, Buffer.from(`\r\n--${b}--\r\n`)]);
  const r = await app.inject({ method: 'POST', url, payload, headers: { 'content-type': `multipart/form-data; boundary=${b}`, cookie: c.cookie } });
  let body: any = r.body; try { body = JSON.parse(r.body); } catch { /* */ }
  return { status: r.statusCode, body };
}
const png = (color: string) => sharp({ create: { width: 900, height: 600, channels: 3, background: color } }).png().toBuffer();
const mk = (c: any, extra: any = {}) => c.post('/api/properties', { title: 'Imóvel ' + uniq(), kind: 'urbano', subtype: 'casa', purposes: ['venda'], price_sale: 300000, status: 'disponivel', publish_authorized: true, city: 'Cidade', state: 'SP', ...extra }).then((r: any) => r.body);
const page = async (url: string) => { const r = await app.inject({ method: 'GET', url }); return { status: r.statusCode, html: r.body as string, headers: r.headers }; };
const slugOf = async (admin: any) => (await admin.get('/api/brand')).body.vitrine_url.split('/v/')[1].replace(/\?.*/, '');
/** Garante que todo <script> inline da página é JavaScript válido (pegaria um ";" faltando). */
const scriptsCompile = (html: string) => {
  const list = [...html.matchAll(/<script(?![^>]*(?:src=|ld\+json))[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  for (const code of list) expect(() => new Function(code)).not.toThrow();
  return list.length;
};

describe('Fase 6 — utilitários do site', () => {
  it('aceita só links do YouTube e do Vimeo', () => {
    expect(parseVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ' });
    expect(parseVideo('https://youtu.be/dQw4w9WgXcQ?t=3')).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ' });
    expect(parseVideo('https://youtube.com/shorts/dQw4w9WgXcQ')).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ' });
    expect(parseVideo('https://vimeo.com/76979871')).toEqual({ provider: 'vimeo', id: '76979871' });
    for (const bad of ['javascript:alert(1)', 'https://evil.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=short', 'not a url', 'https://vimeo.com/abc'])
      expect(parseVideo(bad)).toBeNull();
    expect(socialUrl('instagram', '@casa.azul')).toBe('https://www.instagram.com/casa.azul');
    expect(socialUrl('instagram', 'javascript:alert(1)')).toBeNull();
  });

  it('filtra e ordena imóveis; preço oculto não entra em faixa de preço', () => {
    const base = { kind: 'urbano', subtype: 'casa', purposes: ['venda'], location_tags: [], show_price: true, city: 'São Paulo', features: [] };
    const rows = [
      { ...base, id: 1, title: 'A', price_sale: 500000, bedrooms: 3, parking: 2, area_total: 120 },
      { ...base, id: 2, title: 'B', price_sale: 200000, bedrooms: 1, city: 'Santos', location_tags: ['litoral'] },
      { ...base, id: 3, title: 'C', purposes: ['aluguel'], price_rent: 3000, bedrooms: 2, subtype: 'apartamento' },
      { ...base, id: 4, title: 'D', price_sale: 900000, show_price: false, bedrooms: 4 },
      { ...base, id: 5, title: 'E com piscina', kind: 'rural', subtype: 'sitio', purposes: ['venda', 'arrendamento'], price_sale: 1200000, price_lease: 50000, area_total: 12 },
    ];
    const ids = (q: any) => filterProps(rows, parseFilters(q)).map((r) => r.id);
    expect(ids({ fin: 'aluguel' })).toEqual([3]);
    expect(ids({ fin: 'venda', min: '300.000', max: '1000000' })).toEqual([1]); // D tem preço oculto
    expect(ids({ quartos: '3' })).toEqual([1, 4]);
    expect(ids({ cidade: 'sao paulo', tipo: 'casa' })).toEqual([1, 4]);
    expect(ids({ zona: 'litoral' })).toEqual([2]);
    expect(ids({ zona: 'rural', q: 'PISCINA' })).toEqual([5]);
    expect(ids({ fin: 'venda', ordem: 'menor' })).toEqual([2, 1, 5, 4]);
    expect(ids({ fin: 'arrendamento', max: '60000' })).toEqual([5]);
    expect(ids({ fin: '<script>', tipo: '../x', quartos: 'abc' })).toEqual([1, 2, 3, 4, 5]); // lixo é ignorado
  });
});

describe('Fase 6 — site da vitrine', () => {
  it('imobiliária edita textos, cores, layout, seções, vídeos e fotos; visitante vê o resultado', async () => {
    const { admin } = await newOrg(app, 'Site');
    const slug = await slugOf(admin);
    const p = await mk(admin, { title: 'Casa Editor Teste', description: 'Linda casa com quintal' });
    await admin.post(`/api/properties/${p.id}/publish`);

    const up = await mpUpload(admin, '/api/site/images', await png('#336699'));
    expect(up.status).toBe(201);
    const imgId = up.body.id;
    const r = await admin.patch('/api/site', {
      theme: { bg: '#101820', text: '#f5f5f5', header: 'escuro', font: 'classica', radius: 'redondo', hero: 'dividido', cards: 'lista' },
      hero: { title: 'Seu novo lar <script>x</script>', subtitle: 'Casas e sítios', images: [imgId] },
      about: { title: 'Quem somos', text: 'Desde 1999 no mercado.', image: imgId },
      contact: { phone: '(11) 3333-4444', email: 'contato@exemplo.com', address: 'Rua A, 10 - Centro', instagram: '@casa.azul', hours: 'Seg a sex, 9h às 18h' },
      videos: [{ url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Tour' }],
      gallery: [{ id: imgId, caption: 'Nossa loja' }],
      sections: [{ id: 'sobre', on: true }, { id: 'imoveis', on: true }, { id: 'avaliacao', on: false }],
      footer: 'CRECI 0000-J',
    });
    expect(r.status).toBe(200);
    const { html, status } = await page(`/v/${slug}`);
    expect(status).toBe(200);
    for (const t of ['--bg:#101820', 'Georgia', 'hero div', 'class="sc lista"', 'Quem somos', 'Desde 1999', 'youtube-nocookie.com/embed/dQw4w9WgXcQ', 'Nossa loja', 'Seg a sex', 'https://www.instagram.com/casa.azul', 'CRECI 0000-J', 'Casa Editor Teste', `/v/${slug}/imovel/`, `/api/public/site/${slug}/img/${imgId}`])
      expect(html).toContain(t);
    expect(html).not.toContain('<script>x</script>');
    expect(html).not.toContain('id="avaliacao"'); // seção desligada
    expect(html.indexOf('id="sobre"')).toBeLessThan(html.indexOf('id="imoveis"')); // ordem escolhida
    expect(scriptsCompile(html)).toBeGreaterThan(0);
    expect(html).toContain('.flt details:not([open]) .fg'); // regressão: filtros abrem no celular
    expect(html).toContain('--pt:color-mix'); // fundo escuro clareia preços e links
    // imagem pública servida e reprocessada
    const img = await app.inject({ method: 'GET', url: `/api/public/site/${slug}/img/${imgId}?w=600` });
    expect(img.statusCode).toBe(200); expect(img.headers['content-type']).toBe('image/webp');

    // validações
    expect((await admin.patch('/api/site', { theme: { bg: 'red' } })).status).toBe(400);
    expect((await admin.patch('/api/site', { videos: [{ url: 'https://evil.com/v.mp4' }] })).status).toBe(400);
    expect((await admin.patch('/api/site', { contact: { email: 'x' } })).status).toBe(400);

    // excluir a foto remove de capa, sobre e galeria
    expect((await admin.del(`/api/site/images/${imgId}`)).status).toBe(200);
    const s = (await admin.get('/api/site')).body.site;
    expect(s.hero.images).toEqual([]); expect(s.about.image).toBe(''); expect(s.gallery).toEqual([]);
    expect((await app.inject({ method: 'GET', url: `/api/public/site/${slug}/img/${imgId}` })).statusCode).toBe(404);
  });

  it('só quem administra edita o site; imagens de outra imobiliária não podem ser usadas', async () => {
    const A = await newOrg(app, 'SiteA'); const B = await newOrg(app, 'SiteB');
    const corretor = await addUser(app, A.admin, 'corretor');
    expect((await corretor.patch('/api/site', { footer: 'x' })).status).toBe(403);
    expect((await mpUpload(corretor, '/api/site/images', await png('#000'))).status).toBe(403);
    const upB = await mpUpload(B.admin, '/api/site/images', await png('#f00'));
    expect((await A.admin.patch('/api/site', { hero: { images: [upB.body.id] } })).status).toBe(400);
    expect((await A.admin.del(`/api/site/images/${upB.body.id}`)).status).toBe(404);
    const slugA = await slugOf(A.admin);
    expect((await app.inject({ method: 'GET', url: `/api/public/site/${slugA}/img/${upB.body.id}` })).statusCode).toBe(404);
    expect((await mpUpload(A.admin, '/api/site/images', Buffer.from('<svg onload=alert(1)></svg>'))).status).toBe(415);
  });

  it('página do imóvel no site: galeria, vídeo, contato; isolada por imobiliária; filtros por link', async () => {
    const A = await newOrg(app, 'DetA'); const B = await newOrg(app, 'DetB');
    const slugA = await slugOf(A.admin), slugB = await slugOf(B.admin);
    const casa = await mk(A.admin, { title: 'Casa Detalhe Teste', bedrooms: 3, features: ['Piscina'] });
    const apto = await mk(A.admin, { title: 'Apto Aluguel Detalhe', purposes: ['aluguel'], price_sale: undefined, price_rent: 2800, subtype: 'apartamento' });
    const outra = await mk(B.admin, { title: 'Casa da Outra Imob' });
    for (const [c, p] of [[A.admin, casa], [A.admin, apto], [B.admin, outra]] as const) await c.post(`/api/properties/${p.id}/publish`);
    const codeOf = async (c: any, id: string) => (await c.get(`/api/properties/${id}`)).body.public_code;
    const code = await codeOf(A.admin, casa.id), codeB = await codeOf(B.admin, outra.id);

    expect((await A.admin.put(`/api/properties/${casa.id}/videos`, { videos: [{ url: 'https://vimeo.com/76979871', title: 'Tour da casa' }] })).status).toBe(200);
    expect((await B.admin.put(`/api/properties/${casa.id}/videos`, { videos: [] })).status).toBe(404); // outra imobiliária
    expect((await A.admin.put(`/api/properties/${casa.id}/videos`, { videos: [{ url: 'ftp://x' }] })).status).toBe(400);

    const d = await page(`/v/${slugA}/imovel/${code}`);
    expect(d.status).toBe(200);
    for (const t of ['Casa Detalhe Teste', 'player.vimeo.com/video/76979871', 'Tour da casa', 'Piscina', 'id="lf"', 'Todos os imóveis']) expect(d.html).toContain(t);
    expect(scriptsCompile(d.html)).toBeGreaterThan(0);
    expect(d.headers['content-security-policy']).toContain('player.vimeo.com');
    // imóvel de outra imobiliária não aparece no site desta
    expect((await page(`/v/${slugA}/imovel/${codeB}`)).status).toBe(404);
    expect((await page(`/v/${slugB}/imovel/${code}`)).status).toBe(404);

    // filtro por link
    const f = await page(`/v/${slugA}?fin=aluguel`);
    expect(f.html).toContain('Apto Aluguel Detalhe'); expect(f.html).not.toContain('>Casa Detalhe Teste<');
    expect(f.html).toContain('Limpar filtros');
    // a página antiga /p continua funcionando e com script válido
    expect(scriptsCompile((await page(`/p/${code}`)).html)).toBeGreaterThan(0);
  });
});
