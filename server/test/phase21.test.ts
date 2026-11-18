// Fase 21 — garantidores, vistorias e calendário de temporada.
import { describe, it, expect, beforeAll } from 'vitest';
import { newApp, newOrg, addUser, CPF_OK, CPF_OK_2 } from './helpers.js';
import { q } from '../src/db/pool.js';
import { checklist, compareItems } from '../src/routes/contractExtras.js';

let app: any;
beforeAll(async () => { app = await newApp(); });
const day = (n: number) => new Date(Date.now() - 3 * 3600_000 + n * 86400000).toISOString().slice(0, 10);

async function contrato(admin: any, kind: 'locacao' | 'arrendamento' = 'locacao') {
  const prop = (await admin.post('/api/properties', { title: 'Casa', kind: 'urbano', subtype: 'casa', purposes: ['aluguel'], price_rent: 2000, status: 'disponivel' })).body;
  const a = (await admin.post('/api/people', { kind: 'fisica', name: 'Dono', document: CPF_OK, phones: [], emails: [], roles: ['proprietario'] })).body;
  const b = (await admin.post('/api/people', { kind: 'fisica', name: 'Inquilino', document: CPF_OK_2, phones: [], emails: [], roles: ['locatario'] })).body;
  const c = (await admin.post('/api/contracts', { kind, property_id: prop.id, owner_person_id: a.id, counterparty_person_id: b.id, start_date: day(-70), end_date: day(295), value_amount: 2000, value_period: 'mensal', due_day: 5 })).body;
  return { c, prop, a, b };
}

describe('garantidores', () => {
  it('valida campos por modalidade e permite só uma modalidade na locação', async () => {
    const { admin } = await newOrg(app, 'Gar'); const { c, a } = await contrato(admin);
    expect((await admin.post(`/api/contracts/${c.id}/guarantors`, { kind: 'fiador' })).status).toBe(400);
    expect((await admin.post(`/api/contracts/${c.id}/guarantors`, { kind: 'caucao' })).status).toBe(400);
    expect((await admin.post(`/api/contracts/${c.id}/guarantors`, { kind: 'seguro_fianca' })).status).toBe(400);
    const f = await admin.post(`/api/contracts/${c.id}/guarantors`, { kind: 'fiador', person_id: a.id });
    expect(f.status).toBe(201);
    expect((await admin.post(`/api/contracts/${c.id}/guarantors`, { kind: 'avalista', description: 'Fulano' })).status).toBe(201); // mesma modalidade (pessoal)
    expect((await admin.post(`/api/contracts/${c.id}/guarantors`, { kind: 'caucao', amount: 6000 })).status).toBe(409);
    await admin.patch(`/api/guarantors/${f.body.id}`, { status: 'encerrada' });
    const list = (await admin.get(`/api/contracts/${c.id}/guarantors`)).body;
    expect(list.map((g: any) => g.status).sort()).toEqual(['ativa', 'encerrada']);
  });
  it('gera alerta quando o seguro-fiança está para vencer', async () => {
    const { admin } = await newOrg(app, 'GarAl'); const { c } = await contrato(admin);
    expect((await admin.post(`/api/contracts/${c.id}/activate`)).status).toBe(200);
    expect((await admin.post(`/api/contracts/${c.id}/guarantors`, { kind: 'seguro_fianca', policy_number: 'A1', valid_until: day(10) })).status).toBe(201);
    const al = (await admin.get('/api/contracts/alerts')).body.filter((x: any) => x.type === 'garantia');
    expect(al).toHaveLength(1); expect(al[0].message).toContain('vence em');
  });
  it('isola por imobiliária e exige permissão', async () => {
    const { admin } = await newOrg(app, 'GarIso'); const { c } = await contrato(admin);
    const g = (await admin.post(`/api/contracts/${c.id}/guarantors`, { kind: 'caucao', amount: 3000 })).body;
    const { admin: outro } = await newOrg(app, 'GarOutro');
    expect((await outro.get(`/api/contracts/${c.id}/guarantors`)).status).toBe(404);
    expect((await outro.del(`/api/guarantors/${g.id}`)).status).toBe(404);
    const consulta = await addUser(app, admin, 'consulta');
    expect((await consulta.post(`/api/contracts/${c.id}/guarantors`, { kind: 'caucao', amount: 1 })).status).toBe(403);
  });
});

describe('vistorias', () => {
  it('compara itens que pioraram (função pura)', () => {
    const e = checklist('urbano').map((i) => ({ ...i, condition: 'bom' as string })) as any[];
    const s = e.map((i) => ({ ...i }));
    s[0].condition = 'ruim'; s[1].condition = 'otimo';
    const r = compareItems(e, s);
    expect(r).toHaveLength(1); expect(r[0].after).toBe('ruim');
    expect(checklist('vazio')).toEqual([]);
    expect(checklist('rural')[0].room).toContain('Sede');
  });
  it('cria entrada, edita, conclui, trava, compara com a saída e gera laudo', async () => {
    const { admin } = await newOrg(app, 'Vist'); const { c } = await contrato(admin);
    const e = (await admin.post(`/api/contracts/${c.id}/inspections`, { kind: 'entrada', inspected_on: day(-70) })).body;
    expect(e.items.length).toBeGreaterThan(10);
    const items = e.items.map((i: any) => ({ ...i, condition: 'bom' }));
    expect((await admin.patch(`/api/inspections/${e.id}`, { items, meters: 'Luz 123', status: 'concluida' })).status).toBe(200);
    expect((await admin.patch(`/api/inspections/${e.id}`, { general_notes: 'x' })).status).toBe(409);
    expect((await admin.post(`/api/contracts/${c.id}/inspections/compare`, {})).status).toBeGreaterThanOrEqual(400);
    expect((await admin.get(`/api/contracts/${c.id}/inspections/compare`)).status).toBe(400); // falta a saída
    const s = (await admin.post(`/api/contracts/${c.id}/inspections`, { kind: 'saida', inspected_on: day(0), template: 'copiar_entrada' })).body;
    expect(s.items.every((i: any) => i.condition === 'na')).toBe(true);
    const si = s.items.map((i: any, k: number) => ({ ...i, condition: k === 0 ? 'danificado' : 'bom', notes: k === 0 ? 'Mancha <b>grande</b>' : undefined }));
    await admin.patch(`/api/inspections/${s.id}`, { items: si });
    const cmp = (await admin.get(`/api/contracts/${c.id}/inspections/compare`)).body;
    expect(cmp.pioraram).toHaveLength(1); expect(cmp.pioraram[0].after_label).toBe('Danificado');
    const list = (await admin.get(`/api/contracts/${c.id}/inspections`)).body;
    expect(list).toHaveLength(2); expect(list[0].resumo.avaliados).toBe(e.items.length);
    const html = await app.inject({ method: 'GET', url: `/api/inspections/${s.id}/print`, headers: { cookie: admin.cookie } });
    expect(html.statusCode).toBe(200); expect(html.body).toContain('Laudo de vistoria'); expect(html.body).not.toContain('<b>grande</b>'); expect(html.body).toContain('&lt;b&gt;');
    expect(html.headers['content-type']).toContain('text/html');
  });
  it('saída copiando entrada exige entrada existente; outra org não acessa', async () => {
    const { admin } = await newOrg(app, 'Vist2'); const { c } = await contrato(admin);
    expect((await admin.post(`/api/contracts/${c.id}/inspections`, { kind: 'saida', inspected_on: day(0), template: 'copiar_entrada' })).status).toBe(400);
    const v = (await admin.post(`/api/contracts/${c.id}/inspections`, { kind: 'periodica', inspected_on: day(0), template: 'vazio' })).body;
    const { admin: outro } = await newOrg(app, 'Vist2Outro');
    expect((await outro.get(`/api/inspections/${v.id}`)).status).toBe(404);
    expect((await outro.del(`/api/inspections/${v.id}`)).status).toBe(404);
    expect((await admin.del(`/api/inspections/${v.id}`)).status).toBe(200);
  });
});

describe('calendário de temporada', () => {
  const mkProp = async (admin: any) => (await admin.post('/api/properties', { title: 'Praia', kind: 'urbano', subtype: 'casa', purposes: ['temporada'], price_rent: 500, status: 'disponivel' })).body.id as string;
  it('impede sobreposição, libera o dia do check-out e ignora canceladas', async () => {
    const { admin } = await newOrg(app, 'Temp'); const p = await mkProp(admin);
    const r1 = await admin.post(`/api/properties/${p}/stays`, { start_date: day(10), end_date: day(15), guest_name: 'Ana' });
    expect(r1.status).toBe(201);
    expect((await admin.post(`/api/properties/${p}/stays`, { start_date: day(14), end_date: day(18) })).status).toBe(409);
    expect((await admin.post(`/api/properties/${p}/stays`, { start_date: day(8), end_date: day(11) })).status).toBe(409);
    expect((await admin.post(`/api/properties/${p}/stays`, { start_date: day(15), end_date: day(18) })).status).toBe(201); // check-in no dia do check-out
    expect((await admin.post(`/api/properties/${p}/stays`, { start_date: day(20), end_date: day(20) })).status).toBe(400);
    expect((await admin.post(`/api/properties/${p}/stays`, { start_date: '2026-02-30', end_date: '2026-03-02' })).status).toBe(400);
    await admin.patch(`/api/stays/${r1.body.id}`, { status: 'cancelada' });
    expect((await admin.post(`/api/properties/${p}/stays`, { start_date: day(11), end_date: day(13), status: 'bloqueio' })).status).toBe(201);
    expect((await admin.patch(`/api/stays/${r1.body.id}`, { status: 'confirmada' })).status).toBe(409); // reativar colidiria com o bloqueio
  });
  it('duas reservas simultâneas nas mesmas datas: só uma passa', async () => {
    const { admin } = await newOrg(app, 'TempRace'); const p = await mkProp(admin);
    const rs = await Promise.all([1, 2, 3].map(() => admin.post(`/api/properties/${p}/stays`, { start_date: day(30), end_date: day(33) })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
  });
  it('feed iCal só com datas (sem hóspede) e token revogável', async () => {
    const { admin } = await newOrg(app, 'TempIcal'); const p = await mkProp(admin);
    await admin.post(`/api/properties/${p}/stays`, { start_date: day(5), end_date: day(8), guest_name: 'Segredo Silva', total_amount: 999 });
    const t = (await admin.post(`/api/properties/${p}/ical-token`)).body;
    const r = await app.inject({ method: 'GET', url: t.path });
    expect(r.statusCode).toBe(200); expect(r.headers['content-type']).toContain('text/calendar');
    expect(r.body).toContain('BEGIN:VEVENT'); expect(r.body).toContain('SUMMARY:Ocupado'); expect(r.body).not.toContain('Segredo'); expect(r.body).not.toContain('999');
    expect(r.body).toContain(`DTSTART;VALUE=DATE:${day(5).replace(/-/g, '')}`);
    expect((await app.inject({ method: 'GET', url: '/ical/tokenInvalido1234567890abc.ics' })).statusCode).toBe(404);
    await admin.del(`/api/properties/${p}/ical-token`);
    expect((await app.inject({ method: 'GET', url: t.path })).statusCode).toBe(404);
  });
  it('disponibilidade pública só para temporada publicada, sem dados pessoais', async () => {
    const { admin } = await newOrg(app, 'TempPub'); const p = await mkProp(admin);
    await q('UPDATE properties SET publish_authorized=true WHERE id=$1', [p]);
    const pub = (await admin.post(`/api/properties/${p}/publish`)).body;
    expect(pub.code).toBeTruthy();
    await admin.post(`/api/properties/${p}/stays`, { start_date: day(5), end_date: day(8), guest_name: 'Segredo Silva' });
    await admin.post(`/api/properties/${p}/stays`, { start_date: day(20), end_date: day(22), status: 'cancelada' });
    const r = await app.inject({ method: 'GET', url: `/api/public/p/${pub.code}/availability` });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).busy).toEqual([{ from: day(5), to: day(8) }]);
    expect(r.body).not.toContain('Segredo');
    expect((await app.inject({ method: 'GET', url: '/api/public/p/zzzzzzzz/availability' })).statusCode).toBe(404);
    // imóvel que não é de temporada não expõe calendário
    const venda = (await admin.post('/api/properties', { title: 'V', kind: 'urbano', subtype: 'casa', purposes: ['venda'], price_sale: 1, status: 'disponivel' })).body.id;
    await q('UPDATE properties SET publish_authorized=true WHERE id=$1', [venda]);
    const v = (await admin.post(`/api/properties/${venda}/publish`)).body;
    expect((await app.inject({ method: 'GET', url: `/api/public/p/${v.code}/availability` })).statusCode).toBe(404);
  });
  it('isola por imobiliária e exige permissão', async () => {
    const { admin } = await newOrg(app, 'TempIso'); const p = await mkProp(admin);
    const s = (await admin.post(`/api/properties/${p}/stays`, { start_date: day(5), end_date: day(8) })).body;
    const { admin: outro } = await newOrg(app, 'TempOutro');
    expect((await outro.get(`/api/properties/${p}/stays`)).status).toBe(404);
    expect((await outro.patch(`/api/stays/${s.id}`, { notes: 'x' })).status).toBe(404);
    expect((await outro.del(`/api/stays/${s.id}`)).status).toBe(404);
    const consulta = await addUser(app, admin, 'consulta');
    expect((await consulta.post(`/api/properties/${p}/stays`, { start_date: day(40), end_date: day(41) })).status).toBe(403);
  });
});
