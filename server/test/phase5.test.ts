import { describe, it, expect, beforeAll } from 'vitest';
import sharp from 'sharp';
import { newApp, newOrg, addUser, uniq } from './helpers.js';

let app: any;
beforeAll(async () => { app = await newApp(); });

async function mpUpload(c: any, url: string, file: Buffer, fields: Record<string, string> = {}, filename = 'a.png') {
  const b = '----v' + uniq();
  const parts: Buffer[] = Object.entries(fields).map(([k, v]) => Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`), file, Buffer.from(`\r\n--${b}--\r\n`));
  const r = await app.inject({ method: 'POST', url, payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${b}`, cookie: c.cookie } });
  let body: any = r.body; try { body = JSON.parse(r.body); } catch { /* */ }
  return { status: r.statusCode, body };
}
const png = (color: string, w = 1200, h = 800) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
const mk = (c: any, extra: any = {}) => c.post('/api/properties', { title: 'Imóvel ' + uniq(), kind: 'urbano', subtype: 'casa', purposes: ['venda'], price_sale: 300000, status: 'disponivel', publish_authorized: true, city: 'Cidade', state: 'SP', description: 'Descrição <b>x</b>', ...extra }).then((r: any) => r.body);

describe('Fase 5 — vitrine, marca, QR e cartão', () => {
  it('vitrine agrupa por categorias, mostra só publicados/disponíveis e não vaza dados', async () => {
    const { admin } = await newOrg(app, 'Vit');
    const slug = (await admin.get('/api/brand')).body.vitrine_url.split('/v/')[1];
    const venda = await mk(admin, { title: 'Casa Venda Teste', internal_notes: 'SEGREDO-INT' });
    const alug = await mk(admin, { title: 'Apto Aluguel Teste', purposes: ['aluguel'], price_sale: undefined, price_rent: 2500 });
    const rural = await mk(admin, { title: 'Sítio Rural Teste', kind: 'rural', subtype: 'sitio', purposes: ['venda', 'arrendamento'], price_lease: 4000, area_total: 10, area_unit: 'ha' });
    const praia = await mk(admin, { title: 'Casa de Praia Teste', location_tags: ['litoral'], purposes: ['venda'] });
    const oculto = await mk(admin, { title: 'Nao Publicado Teste' });
    const semPreco = await mk(admin, { title: 'Sem Preco Teste', show_price: false });
    for (const p of [venda, alug, rural, praia, semPreco]) expect((await admin.post(`/api/properties/${p.id}/publish`)).status).toBe(200);
    await admin.patch(`/api/properties/${rural.id}/feature`, { featured: true });
    const ph = await mpUpload(admin, `/api/properties/${venda.id}/files`, await png('#336699'), { category: 'foto', visibility: 'publico' });
    const priv = await mpUpload(admin, `/api/properties/${venda.id}/files`, await png('#993333'), { category: 'foto', visibility: 'privado' });
    const r = await app.inject({ method: 'GET', url: `/v/${slug}?o=qr`, headers: { 'user-agent': 'Mozilla/5.0' } });
    expect(r.statusCode).toBe(200);
    const html = r.body;
    for (const id of ['destaques', 'imoveis']) expect(html).toContain(`id="${id}"`);
    for (const qs of ['fin=venda', 'fin=aluguel', 'zona=litoral', 'zona=rural']) expect(html).toContain(`?${qs}#imoveis`); // categorias viram filtros
    expect(html).toContain('Casa Venda Teste'); expect(html).toContain('Casa de Praia Teste');
    expect(html).not.toContain('Nao Publicado Teste');
    expect(html).not.toContain('SEGREDO-INT');
    expect(html).not.toContain('<b>x</b>'); // escapado
    expect(html).toContain(ph.body.id); expect(html).not.toContain(priv.body.id);
    expect(html).toContain('Valor sob consulta');
    // despublicar remove da vitrine; vendido também
    await admin.post(`/api/properties/${alug.id}/unpublish`);
    await admin.patch(`/api/properties/${praia.id}`, { status: 'vendido' });
    const h2 = (await app.inject({ method: 'GET', url: `/v/${slug}`, headers: { 'user-agent': 'Mozilla/5.0' } })).body;
    expect(h2).not.toContain('Apto Aluguel Teste'); expect(h2).not.toContain('Casa de Praia Teste');
    // acessos por origem
    const g = (await admin.get('/api/growth')).body;
    expect(g.vitrine_last_30_days.qr).toBe(1);
    // slug inexistente / malformado
    expect((await app.inject({ method: 'GET', url: '/v/nao-existe-xyz' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: "/v/a'--" })).statusCode).toBe(404);
  });

  it('miniaturas, QR público e sitemap', async () => {
    const { admin } = await newOrg(app, 'Qr');
    const slug = (await admin.get('/api/brand')).body.vitrine_url.split('/v/')[1];
    const p = await mk(admin);
    const f = await mpUpload(admin, `/api/properties/${p.id}/files`, await png('#445566', 2000, 1500), { category: 'foto', visibility: 'publico' });
    await admin.post(`/api/properties/${p.id}/publish`);
    const t = await app.inject({ method: 'GET', url: `/api/public/files/${f.body.id}?w=640` });
    expect(t.headers['content-type']).toBe('image/webp');
    const meta = await sharp(t.rawPayload).metadata();
    expect(meta.width).toBe(640);
    expect(t.rawPayload.length).toBeLessThan(40000);
    const qr = await app.inject({ method: 'GET', url: `/api/public/vitrine/${slug}/qr.svg` });
    expect(qr.headers['content-type']).toContain('image/svg+xml');
    expect(qr.body).toContain('<path');
    expect((await app.inject({ method: 'GET', url: '/api/public/vitrine/nao-existe/qr.svg' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/sitemap.xml' })).body).toContain(`/v/${slug}`);
  });

  it('marca: cores validadas, logo reprocessada (SVG recusado), só admin edita', async () => {
    const { admin } = await newOrg(app, 'Marca');
    expect((await admin.patch('/api/brand', { primary: 'vermelho' })).status).toBe(400);
    expect((await admin.patch('/api/brand', { primary: '#123456', secondary: '#ffaa00', tagline: 'Seu lar, nossa missão', card_layout: 'moderno' })).status).toBe(200);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const rs = await mpUpload(admin, '/api/brand/logo', svg, {}, 'logo.svg'); expect(rs.status).toBe(415); expect(rs.body.error).toContain('SVG');
    const rn = await mpUpload(admin, '/api/brand/logo', Buffer.from('nao e imagem'), {}, 'logo.png'); expect(rn.status).toBe(415); expect(rn.body.error).toContain('PNG');
    const ok = await mpUpload(admin, '/api/brand/logo', await png('#abcdef', 3000, 1000));
    expect(ok.body).toMatchObject({ ok: true });
    const b = (await admin.get('/api/brand')).body;
    expect(b.has_logo).toBe(true);
    const logo = await app.inject({ method: 'GET', url: b.logo_url });
    expect(logo.headers['content-type']).toBe('image/png');
    expect((await sharp(logo.rawPayload).metadata()).width).toBeLessThanOrEqual(800);
    const corretor = await addUser(app, admin, 'corretor');
    expect((await corretor.patch('/api/brand', { primary: '#000000' })).status).toBe(403);
    expect((await mpUpload(corretor, '/api/brand/logo', await png('#000000'))).status).toBe(403);
    // vitrine usa as cores e a logo
    const slug = b.vitrine_url.split('/v/')[1];
    const html = (await app.inject({ method: 'GET', url: `/v/${slug}`, headers: { 'user-agent': 'Mozilla/5.0' } })).body;
    expect(html).toContain('--p:#123456'); expect(html).toContain(`/api/public/brand/${slug}/logo`); expect(html).toContain('Seu lar, nossa missão');
    // outra organização não altera/enxerga a marca
    const { admin: other } = await newOrg(app, 'Outra');
    expect((await other.get('/api/brand')).body.has_logo).toBe(false);
  });

  it('cartão de visita: PNG/SVG nos 3 layouts, dados escapados, QR da vitrine', async () => {
    const { admin } = await newOrg(app, 'Cartao');
    await admin.patch('/api/brand', { primary: '#7c3aed', secondary: '#facc15' });
    await mpUpload(admin, '/api/brand/logo', await png('#ffffff', 600, 300));
    expect((await admin.patch('/api/card/profile', { phone: '123' })).status).toBe(400);
    expect((await admin.patch('/api/card/profile', { title: 'Corretor <script>x</script> & Cia', phone: '(11) 98888-7777', creci: 'CRECI 12345-F' })).status).toBe(200);
    for (const layout of ['classico', 'moderno', 'minimal']) for (const side of ['front', 'back']) {
      const r = await admin.get(`/api/card/${side}.png?layout=${layout}`);
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toBe('image/png');
      const raw = await app.inject({ method: 'GET', url: `/api/card/${side}.png?layout=${layout}`, headers: { cookie: admin.cookie } });
      const m = await sharp(raw.rawPayload).metadata();
      expect([m.width, m.height]).toEqual([1063, 591]);
    }
    const svg = (await app.inject({ method: 'GET', url: '/api/card/front.svg?layout=moderno', headers: { cookie: admin.cookie } })).body;
    expect(svg).not.toContain('<script'); expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('#7c3aed');
    expect((await admin.get('/api/card/front.png?layout=zzz')).status).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/card/front.png' })).statusCode).toBe(401); // exige login
    // cartão é individual: corretor não vê dados de outro
    const corretor = await addUser(app, admin, 'corretor');
    const mine = (await corretor.get('/api/card/profile')).body;
    expect(mine.phone).toBe('');
  });
});

describe('Fase 5 — cartão com serviços e avaliação de imóveis', () => {
  it('cartão lista os serviços em coluna (inclui avaliação), alterna nome em destaque e valida serviços', async () => {
    const { admin } = await newOrg(app, 'Serv');
    const front = async (q = '') => (await app.inject({ method: 'GET', url: `/api/card/front.svg${q}`, headers: { cookie: admin.cookie } })).body as string;
    let svg = await front('?layout=classico');
    for (const t of ['Vendas, aluguel e arrendamentos', 'Imóveis urbanos, rurais e litorais', 'Avaliação de imóveis', 'NOSSOS SERVIÇOS', 'CLIQUE AQUI']) expect(svg).toContain(t);
    // serviços configuráveis (1 a 5), escapados
    expect((await admin.patch('/api/brand', { services: [] })).status).toBe(400);
    expect((await admin.patch('/api/brand', { services: ['a', 'b', 'c', 'd', 'e', 'f'].map((x) => x + 'xx') })).status).toBe(400);
    expect((await admin.patch('/api/brand', { services: ['Consultoria <rural>', 'Avaliação de imóveis'] })).status).toBe(200);
    svg = await front('?layout=moderno');
    expect(svg).toContain('Consultoria &lt;rural&gt;'); expect(svg).not.toContain('Venda de imóveis');
    // nome em destaque: imobiliária x corretor
    const orgName = (await admin.get('/api/brand')).body.name;
    await admin.patch('/api/card/profile', { headline: 'imobiliaria', title: 'Corretor Sênior' });
    const a = await front('?layout=minimal');
    expect(a.indexOf(orgName.slice(0, 8))).toBeGreaterThan(-1);
    const b = await front('?layout=minimal&headline=corretor');
    expect(b).toContain('font-weight="800" fill="#111827">Admin Serv'); 
    expect((await admin.get('/api/card/front.png?headline=xx')).status).toBe(400);
    // 3 layouts renderizam em PNG 1063x591
    for (const layout of ['classico', 'moderno', 'minimal']) {
      const r = await app.inject({ method: 'GET', url: `/api/card/front.png?layout=${layout}`, headers: { cookie: admin.cookie } });
      const m = await sharp(r.rawPayload).metadata(); expect([m.width, m.height]).toEqual([1063, 591]);
    }
  });

  it('pedido de avaliação na vitrine: token/honeypot/validação, vira contato e cliente; isolado por organização', async () => {
    const { admin } = await newOrg(app, 'Aval');
    const slug = (await admin.get('/api/brand')).body.vitrine_url.split('/v/')[1];
    const page = (await app.inject({ method: 'GET', url: `/v/${slug}`, headers: { 'user-agent': 'Mozilla/5.0' } })).body;
    expect(page).toContain('id="avaliacao"'); expect(page).toContain('Solicitar avaliação');
    const crypto = await import('node:crypto'); const { config } = await import('../src/lib/config.js');
    const ts = Date.now() - 10000; const token = `${ts}.${crypto.createHmac('sha256', config.formSecret).update(`v:${slug}.${ts}`).digest('hex')}`;
    const post = (extra: any = {}, tk = token) => app.inject({ method: 'POST', url: `/api/public/vitrine/${slug}/avaliacao`, headers: { 'content-type': 'application/json' }, payload: { token: tk, name: 'Dona Maria', phone: '11977776666', property_type: 'casa', address: 'Centro, Campinas/SP', consent: true, website: '', ...extra } });
    expect((await post({}, 'forjado.xx')).statusCode).toBe(400);
    expect((await post({ consent: false })).statusCode).toBe(400);
    expect((await post({ address: '' })).statusCode).toBe(400);
    expect((await post({ property_type: 'nave' })).statusCode).toBe(400);
    expect((await post({ website: 'spam' })).statusCode).toBe(201);
    expect((await admin.get('/api/leads')).body).toHaveLength(0);
    expect((await post({ message: 'Casa de esquina' })).statusCode).toBe(201);
    expect((await post({})).statusCode).toBe(201); // duplicado em 24h não cria outro
    const leads = (await admin.get('/api/leads?status=novo')).body;
    expect(leads).toHaveLength(1); expect(leads[0].kind).toBe('avaliacao'); expect(leads[0].property_id).toBeNull(); expect(leads[0].details.address).toContain('Campinas');
    const cv = await admin.post(`/api/leads/${leads[0].id}/convert`);
    expect(cv.status).toBe(200);
    const person = (await admin.get(`/api/people/${cv.body.person_id}`)).body;
    expect(person.interactions[0].body).toContain('avaliação'); expect(person.interactions[0].body).toContain('Casa de esquina');
    expect((await app.inject({ method: 'POST', url: '/api/public/vitrine/nao-existe/avaliacao', headers: { 'content-type': 'application/json' }, payload: { token, name: 'X Y', phone: '11977776666', property_type: 'casa', address: 'abc', consent: true } })).statusCode).toBe(400); // token de outra vitrine
    const { admin: other } = await newOrg(app, 'Outra2');
    expect((await other.get('/api/leads')).body).toEqual([]);
  });

  it('imobiliária edita cores e textos do cartão; entradas inválidas são recusadas; botão leva à vitrine', async () => {
    const { admin } = await newOrg(app, 'Custom');
    const front = async () => (await app.inject({ method: 'GET', url: '/api/card/front.svg?layout=minimal', headers: { cookie: admin.cookie } })).body as string;
    const r = await admin.patch('/api/brand', { card: { bg: '#112233', fg: '#fafafa', accent: '#ff8800', headline_text: 'Minha Marca <X>', sub_text: 'Desde 1990', services_title: 'O que fazemos', button_label: 'Veja aqui', contacts: ['Rua A, 10', '(11) 1111-1111'] } });
    expect(r.status).toBe(200);
    const svg = await front();
    for (const t of ['#112233', '#ff8800', 'MINHA MARCA', 'Desde 1990', 'O QUE FAZEMOS', 'VEJA AQUI', 'Rua A, 10']) expect(svg.toUpperCase()).toContain(t.toUpperCase());
    expect(svg).not.toContain('<X>');
    expect(svg).toMatch(/<a href="[^"]*\/v\/[^"]*">/);
    expect((await admin.patch('/api/brand', { card: { bg: 'red' } })).status).toBe(400);
    expect((await admin.patch('/api/brand', { card: { contacts: ['a', 'b', 'c', 'd', 'e'] } })).status).toBe(400);
    // alteração parcial preserva o restante; vazio volta ao padrão
    expect((await admin.patch('/api/brand', { card: { bg: '' } })).status).toBe(200);
    const b = (await admin.get('/api/brand')).body.brand.card;
    expect(b.bg).toBe(''); expect(b.accent).toBe('#ff8800'); expect(b.button_label).toBe('Veja aqui');
  });
});

