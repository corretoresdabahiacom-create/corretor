import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addUser, Client, CNPJ_OK, CPF_OK, CPF_OK_2, newApp, newOrg, uniq } from './helpers.js';
import { isValidCNPJ, isValidCPF } from '../src/lib/validators.js';
import { matchScore } from '../src/routes/properties.js';

let app: FastifyInstance;
beforeAll(async () => { app = await newApp(); });
afterAll(async () => { await app.close(); const { pool } = await import('../src/db/pool.js'); await pool.end(); });

const urbanHouse = (over: any = {}) => ({
  title: 'Casa 3 quartos no Centro', kind: 'urbano', subtype: 'casa', purposes: ['venda'], price_sale: 650000,
  address: { cidade: 'Campinas', uf: 'SP', bairro: 'Centro', cep: '13010-000' }, bedrooms: 3, bathrooms: 2, parking: 2,
  area_total: 250, area_built: 140, area_unit: 'm2', status: 'disponivel', features: ['churrasqueira'], ...over,
});
const farm = (over: any = {}) => ({
  title: 'Fazenda 120 ha com sede', kind: 'rural', subtype: 'fazenda', purposes: ['venda', 'arrendamento'], price_sale: 4800000, price_lease: 18000,
  address: { cidade: 'Barretos', uf: 'SP' }, area_total: 120, area_unit: 'ha', status: 'disponivel',
  rural_details: { water_sources: ['rio', 'poço'], activities: ['pecuária'], registry: { matricula: '12345', car: 'SP-123' } }, ...over,
});
const beach = (over: any = {}) => ({
  title: 'Casa de praia a 80m do mar', kind: 'urbano', subtype: 'casa', purposes: ['temporada', 'venda'], price_rent: 1200, price_sale: 1500000,
  location_tags: ['litoral'], address: { cidade: 'Ubatuba', uf: 'SP', bairro: 'Itamambuca' }, bedrooms: 4, bathrooms: 3, status: 'disponivel',
  coastal_details: { beach_distance_m: 80, beach_distance_source: 'estimada', sea_view: true, guests_capacity: 10, cleaning_fee: 250 }, ...over,
});

describe('validadores', () => {
  it('CPF e CNPJ', () => {
    expect(isValidCPF(CPF_OK)).toBe(true);
    expect(isValidCPF('111.111.111-11')).toBe(false);
    expect(isValidCPF('529.982.247-24')).toBe(false);
    expect(isValidCNPJ(CNPJ_OK)).toBe(true);
    expect(isValidCNPJ('11.222.333/0001-82')).toBe(false);
  });
});

describe('1) organização e administrador / autenticação', () => {
  it('cria imobiliária + admin, loga, vê /me e sai', async () => {
    const { admin, email } = await newOrg(app);
    const me = await admin.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.role).toBe('admin');
    expect(me.body.permissions).toContain('users.manage');
    await admin.post('/api/auth/logout');
    expect((await admin.get('/api/auth/me')).status).toBe(401);
    const c2 = new Client(app);
    expect((await c2.post('/api/auth/login', { email, password: 'errada12345' })).status).toBe(401);
    expect((await c2.post('/api/auth/login', { email, password: 'senhaSegura123' })).status).toBe(200);
    expect((await c2.get('/api/auth/me')).status).toBe(200);
  });
  it('rejeita senha fraca e e-mail repetido', async () => {
    const c = new Client(app);
    const e = `x-${uniq()}@t.dev`;
    expect((await c.post('/api/auth/register', { orgName: 'Fraca', name: 'A B', email: e, password: 'curta' })).status).toBe(400);
    expect((await c.post('/api/auth/register', { orgName: 'Ok', name: 'A B', email: e, password: 'senhaSegura123' })).status).toBe(201);
    expect((await new Client(app).post('/api/auth/register', { orgName: 'Ok2', name: 'A B', email: e, password: 'senhaSegura123' })).status).toBe(409);
  });
  it('recuperação de senha encerra sessões antigas', async () => {
    const { admin, email } = await newOrg(app);
    const f = await new Client(app).post('/api/auth/forgot', { email });
    expect(f.body.devToken).toBeTruthy(); // modo desenvolvimento
    const r = await new Client(app).post('/api/auth/reset', { token: f.body.devToken, password: 'novaSenha12345' });
    expect(r.status).toBe(200);
    expect((await admin.get('/api/auth/me')).status).toBe(401);
    expect((await new Client(app).post('/api/auth/reset', { token: f.body.devToken, password: 'outraSenha12345' })).status).toBe(400); // token de uso único
    expect((await new Client(app).post('/api/auth/login', { email, password: 'novaSenha12345' })).status).toBe(200);
  });
  it('convites: expiração/revogação e papel aplicado', async () => {
    const { admin } = await newOrg(app);
    const inv = await admin.post('/api/invites', { email: `i-${uniq()}@t.dev`, role: 'corretor' });
    const token = inv.body.link.split('/convite/')[1];
    expect((await new Client(app).get(`/api/invites/preview/${token}`)).status).toBe(200);
    await admin.del(`/api/invites/${inv.body.id}`);
    expect((await new Client(app).get(`/api/invites/preview/${token}`)).status).toBe(404);
    expect((await new Client(app).post('/api/invites/accept', { token, name: 'Fulano', password: 'senhaSegura123' })).status).toBe(400);
  });
});

describe('2) pessoas com vários papéis, duplicidade e acesso restrito', () => {
  it('cadastra pessoa com múltiplos papéis e valida documento/telefone', async () => {
    const { admin } = await newOrg(app);
    expect((await admin.post('/api/people', { name: 'João', document: '123.456.789-00' })).status).toBe(400);
    expect((await admin.post('/api/people', { name: 'João', phones: ['123'] })).status).toBe(400);
    const r = await admin.post('/api/people', { name: 'Maria Souza', document: CPF_OK, phones: ['(19) 99999-1111'], emails: ['maria@x.com'], roles: ['proprietario', 'vendedor', 'comprador'] });
    expect(r.status).toBe(201);
    expect(r.body.roles).toEqual(expect.arrayContaining(['proprietario', 'vendedor', 'comprador']));
    const pj = await admin.post('/api/people', { kind: 'juridica', name: 'Agro Ltda', document: CNPJ_OK, roles: ['parceiro'] });
    expect(pj.status).toBe(201);
  });
  it('detecta duplicidade por telefone/e-mail/documento sem mesclar sozinho', async () => {
    const { admin } = await newOrg(app);
    const a = await admin.post('/api/people', { name: 'Ana Lima', document: CPF_OK, phones: ['(11) 98888-7777'], emails: ['ana@x.com'] });
    expect(a.status).toBe(201);
    for (const dup of [{ phones: ['11988887777'] }, { emails: ['ANA@x.com'] }, { document: '52998224725' }]) {
      const r = await admin.post('/api/people', { name: 'Ana L.', ...dup });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('POSSIBLE_DUPLICATE');
      expect(r.body.duplicates[0].id).toBe(a.body.id);
    }
    expect((await admin.post('/api/people?force=true', { name: 'Ana Lima (outra)', phones: ['11988887777'] })).status).toBe(201);
    const list = await admin.get('/api/people?q=ana');
    expect(list.body.total).toBe(2); // nada foi mesclado automaticamente
  });
  it('CPF e observações privadas ficam restritos por papel (no servidor)', async () => {
    const { admin } = await newOrg(app);
    const assistente = await addUser(app, admin, 'assistente');
    const p = await admin.post('/api/people', { name: 'Carlos', document: CPF_OK, private_notes: 'cliente exigente' });
    const asAdmin = await admin.get(`/api/people/${p.body.id}`);
    expect(asAdmin.body.document).toBe(CPF_OK);
    expect(asAdmin.body.private_notes).toBe('cliente exigente');
    const asAssist = await assistente.get(`/api/people/${p.body.id}`);
    expect(asAssist.body.document).not.toContain('529');
    expect(asAssist.body.document_masked).toBe(true);
    expect(asAssist.body.private_notes).toBeNull();
    const list = await assistente.get('/api/people');
    expect(JSON.stringify(list.body)).not.toContain('exigente');
    // editar sem poder ver não apaga o dado escondido
    await assistente.patch(`/api/people/${p.body.id}`, { name: 'Carlos Alberto' });
    const again = await admin.get(`/api/people/${p.body.id}`);
    expect(again.body.document).toBe(CPF_OK);
    expect(again.body.private_notes).toBe('cliente exigente');
  });
});

describe('3/4) imóveis urbano/rural/litoral e busca combinada', () => {
  it('cadastra os três tipos, gera códigos únicos e aplica regras', async () => {
    const { admin } = await newOrg(app);
    const a = await admin.post('/api/properties', urbanHouse());
    const b = await admin.post('/api/properties', farm());
    const c = await admin.post('/api/properties', beach());
    expect([a.status, b.status, c.status]).toEqual([201, 201, 201]);
    expect(new Set([a.body.code, b.body.code, c.body.code]).size).toBe(3);
    expect(b.body.rural_details.registry.matricula).toBe('12345');
    expect(c.body.location_tags).toContain('litoral');
    expect(c.body.kind).toBe('urbano'); // urbano E litorâneo ao mesmo tempo
    // validações
    expect((await admin.post('/api/properties', urbanHouse({ price_sale: undefined }))).status).toBe(400);
    expect((await admin.post('/api/properties', urbanHouse({ subtype: 'fazenda' }))).status).toBe(400);
    expect((await admin.post('/api/properties', urbanHouse({ status: 'em_preparacao', publish_authorized: true }))).status).toBe(400);
  });
  it('filtros combinados, ordenação, hectares e paginação', async () => {
    const { admin } = await newOrg(app);
    await admin.post('/api/properties', urbanHouse());
    await admin.post('/api/properties', urbanHouse({ title: 'Apto Centro', subtype: 'apartamento', price_sale: 400000, bedrooms: 2 }));
    await admin.post('/api/properties', farm());
    await admin.post('/api/properties', farm({ title: 'Sítio 5 alqueires', subtype: 'sitio', price_sale: 900000, price_lease: 4000, area_total: 5, area_unit: 'alqueire', address: { cidade: 'Jaboticabal', uf: 'SP' } }));
    await admin.post('/api/properties', beach());
    const s = (qs: string) => admin.get('/api/properties?' + qs).then((r) => r.body);
    expect((await s('kind=rural')).total).toBe(2);
    expect((await s('kind=rural&area_min_ha=100')).total).toBe(1); // 120 ha (alqueire convertido: 5 × 2,42 = 12,1 ha)
    expect((await s('tag=litoral&purpose=temporada')).total).toBe(1);
    expect((await s('kind=urbano&purpose=venda&price_max=500000')).items.map((i: any) => i.title)).toEqual(['Apto Centro']);
    expect((await s('purpose=arrendamento&price_max=10000')).total).toBe(1);
    expect((await s('q=centro&bedrooms_min=3')).total).toBe(1);
    expect((await s('feature=churrasqueira')).total).toBe(2);
    const asc = (await s('purpose=venda&sort=price_asc')).items.map((i: any) => i.display_price);
    expect(asc).toEqual([...asc].sort((x: number, y: number) => x - y));
    const p1 = await s('pageSize=2&page=1');
    expect(p1.items).toHaveLength(2);
    expect(p1.total).toBe(5);
  });
  it('favoritos privados, busca salva, comparação e semelhantes', async () => {
    const { admin } = await newOrg(app);
    const corretor = await addUser(app, admin, 'corretor');
    const a = (await admin.post('/api/properties', urbanHouse())).body;
    const b = (await admin.post('/api/properties', urbanHouse({ title: 'Casa Vizinha', price_sale: 700000 }))).body;
    await admin.put(`/api/properties/${a.id}/favorite`);
    expect((await admin.get('/api/properties?favorites=true')).body.total).toBe(1);
    expect((await corretor.get('/api/properties?favorites=true')).body.total).toBe(0); // favorito é privado
    const ss = await admin.post('/api/saved-searches', { name: 'Casas SP', filters: { kind: 'urbano', state: 'SP' } });
    expect(ss.status).toBe(201);
    expect((await corretor.get('/api/saved-searches')).body).toHaveLength(0);
    expect((await admin.get(`/api/properties-compare?ids=${a.id},${b.id}`)).body).toHaveLength(2);
    expect((await admin.get(`/api/properties/${a.id}/similar`)).body.map((x: any) => x.id)).toContain(b.id);
  });
  it('compatibilidade explicável entre cliente e imóveis', async () => {
    const { admin } = await newOrg(app);
    const h = (await admin.post('/api/properties', urbanHouse())).body;
    await admin.post('/api/properties', farm());
    const p = await admin.post('/api/people', {
      name: 'Casal Buscando', roles: ['interessado'],
      profile: { purposes: ['venda'], budget_max: 700000, property_kinds: ['casa'], regions: ['campinas'], bedrooms_min: 3 },
    });
    const m = await admin.get(`/api/people/${p.body.id}/matches`);
    expect(m.body.matches[0].property.id).toBe(h.id);
    expect(m.body.matches[0].score).toBeGreaterThanOrEqual(90);
    expect(m.body.matches[0].reasons.join(' ')).toMatch(/orçamento/i);
    expect(matchScore({ purposes: ['venda'], budget_max: 100000 }, { purposes: ['venda'], price_sale: 650000, features: [], location_tags: [] }).mismatches.join()).toMatch(/Acima do orçamento/);
  });
});

describe('6/7/8) oportunidades, funil e agenda', () => {
  async function setup() {
    const { admin } = await newOrg(app);
    const corretor = await addUser(app, admin, 'corretor');
    const person = (await admin.post('/api/people', { name: 'Interessado ' + uniq(), roles: ['interessado'] })).body;
    const prop = (await admin.post('/api/properties', urbanHouse())).body;
    return { admin, corretor, person, prop };
  }
  it('vincula interessado a imóveis, avança o funil e respeita regras de fechamento', async () => {
    const { admin, person, prop } = await setup();
    const d = await admin.post('/api/deals', { person_id: person.id, property_ids: [prop.id], purpose: 'venda', estimated_value: 650000, source: 'indicação' });
    expect(d.status).toBe(201);
    expect(d.body.stage_key).toBe('novo_contato');
    // duplicidade
    const dup = await admin.post('/api/deals', { person_id: person.id, purpose: 'venda' });
    expect(dup.status).toBe(409);
    expect(dup.body.existing_id).toBe(d.body.id);
    for (const st of ['qualificacao', 'imoveis_apresentados']) expect((await admin.post(`/api/deals/${d.body.id}/stage`, { stage_key: st })).status).toBe(200);
    // proposta enviada NÃO fecha negócio nem define valor fechado
    const pr = await admin.post(`/api/deals/${d.body.id}/proposals`, { amount: 600000, property_id: prop.id });
    expect(pr.status).toBe(201);
    let det = (await admin.get(`/api/deals/${d.body.id}`)).body;
    expect(det.closed_value).toBeNull();
    expect(det.negotiated_value).toBeNull();
    await admin.patch(`/api/deals/${d.body.id}/proposals/${pr.body.id}`, { status: 'aceita' });
    det = (await admin.get(`/api/deals/${d.body.id}`)).body;
    expect(det.negotiated_value).toBe(600000);
    expect(det.closed_value).toBeNull(); // negociado ≠ fechado
    // fechar exige valor; perder exige motivo
    expect((await admin.post(`/api/deals/${d.body.id}/stage`, { stage_key: 'fechado' })).status).toBe(400);
    expect((await admin.post(`/api/deals/${d.body.id}/stage`, { stage_key: 'perdido' })).status).toBe(400);
    expect((await admin.post(`/api/deals/${d.body.id}/stage`, { stage_key: 'fechado', closed_value: 610000 })).status).toBe(200);
    det = (await admin.get(`/api/deals/${d.body.id}`)).body;
    expect(det.closed_value).toBe(610000);
    expect((await admin.get(`/api/properties/${prop.id}`)).body.status).toBe('vendido');
    // métricas sem dupla contagem
    const rep = (await admin.get('/api/reports/concluidos')).body.rows;
    expect(rep).toEqual([{ finalidade: 'venda', concluidos: 1, valor_fechado: 610000 }]);
    const conv = (await admin.get('/api/reports/conversao-etapa')).body.rows;
    expect(conv.find((r: any) => r.etapa === 'Novo contato').oportunidades_que_chegaram).toBe(1);
    expect(conv.find((r: any) => r.etapa === 'Fechado').oportunidades_que_chegaram).toBe(1);
  });
  it('reserva só de imóvel disponível; cancelar devolve disponibilidade', async () => {
    const { admin, person, prop } = await setup();
    const d = (await admin.post('/api/deals', { person_id: person.id, property_ids: [prop.id] })).body;
    const r = await admin.post(`/api/deals/${d.id}/reservations`, { property_id: prop.id });
    expect(r.status).toBe(201);
    expect((await admin.get(`/api/properties/${prop.id}`)).body.status).toBe('reservado');
    expect((await admin.post(`/api/deals/${d.id}/reservations`, { property_id: prop.id })).status).toBe(409);
    await admin.del(`/api/reservations/${r.body.id}`);
    expect((await admin.get(`/api/properties/${prop.id}`)).body.status).toBe('disponivel');
  });
  it('agenda: conflito, reagendamento, histórico e conclusão avançando o funil', async () => {
    const { admin, person, prop } = await setup();
    const d = (await admin.post('/api/deals', { person_id: person.id, property_ids: [prop.id] })).body;
    const t0 = new Date(Date.now() + 2 * 86400_000); t0.setMinutes(0, 0, 0);
    const at = (h: number) => new Date(t0.getTime() + h * 3600_000).toISOString();
    const ev = await admin.post('/api/events', { type: 'visita', title: 'Visita casa Centro', starts_at: at(0), ends_at: at(1), person_id: person.id, property_id: prop.id, deal_id: d.id, location: 'Campinas' });
    expect(ev.status).toBe(201);
    expect((await admin.get(`/api/deals/${d.id}`)).body.stage_key).toBe('visita_agendada');
    // conflito alerta e pode ser forçado
    const clash = await admin.post('/api/events', { type: 'reuniao', title: 'Reunião', starts_at: at(0.5), ends_at: at(1.5) });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe('CONFLICT');
    expect((await admin.post('/api/events?force=true', { type: 'reuniao', title: 'Reunião', starts_at: at(0.5), ends_at: at(1.5) })).status).toBe(201);
    // horários adjacentes (fim == início) não conflitam
    expect((await admin.post('/api/events', { type: 'retorno', title: 'Retorno', starts_at: at(5), ends_at: at(6) })).status).toBe(201);
    expect((await admin.post('/api/events', { type: 'retorno', title: 'Retorno 2', starts_at: at(6), ends_at: at(7) })).status).toBe(201);
    // reagendar (com histórico)
    const rs = await admin.post(`/api/events/${ev.body.id}/reschedule`, { starts_at: at(10), ends_at: at(11), reason: 'cliente pediu' });
    expect(rs.status).toBe(200);
    const det = (await admin.get(`/api/events/${ev.body.id}`)).body;
    expect(det.history.map((h: any) => h.action)).toEqual(expect.arrayContaining(['criado', 'reagendado']));
    // concluir exige resultado e avança o funil
    expect((await admin.post(`/api/events/${ev.body.id}/complete`, {})).status).toBe(400);
    const done = await admin.post(`/api/events/${ev.body.id}/complete`, { outcome: 'Gostou, vai pensar', next_action: 'Ligar em 2 dias' });
    expect(done.status).toBe(200);
    expect((await admin.get(`/api/deals/${d.id}`)).body.stage_key).toBe('visita_realizada');
    expect((await admin.post(`/api/events/${ev.body.id}/complete`, { outcome: 'x' })).status).toBe(409); // já encerrado
    // cancelar
    const ev2 = (await admin.post('/api/events', { type: 'captacao', title: 'Captação', starts_at: at(20), ends_at: at(21) })).body;
    expect((await admin.post(`/api/events/${ev2.id}/cancel`, { reason: 'dono desistiu' })).status).toBe(200);
    const v = (await admin.get('/api/reports/visitas')).body.rows;
    expect(v).toEqual([{ status: 'concluido', total: 1 }]);
    // fim antes do início
    expect((await admin.post('/api/events', { type: 'outro', title: 'Inválido', starts_at: at(3), ends_at: at(2) })).status).toBe(400);
  });
  it('corretor só vê as próprias oportunidades e compromissos; gestor vê tudo', async () => {
    const { admin, corretor, person } = await setup();
    const gestor = await addUser(app, admin, 'gestor');
    const mine = (await corretor.post('/api/deals', { person_id: person.id })).body;
    const adminDeal = (await admin.post('/api/deals', { person_id: person.id, purpose: 'aluguel' })).body;
    const lst = (await corretor.get('/api/deals')).body.map((x: any) => x.id);
    expect(lst).toContain(mine.id);
    expect(lst).not.toContain(adminDeal.id);
    expect((await corretor.get(`/api/deals/${adminDeal.id}`)).status).toBe(404);
    expect((await gestor.get('/api/deals')).body.length).toBe(2);
  });
});

describe('12) isolamento multiempresa', () => {
  it('uma organização não acessa nem lista dados de outra', async () => {
    const A = await newOrg(app, 'A');
    const B = await newOrg(app, 'B');
    const person = (await A.admin.post('/api/people', { name: 'Pessoa A', document: CPF_OK_2, phones: ['11977776666'] })).body;
    const prop = (await A.admin.post('/api/properties', urbanHouse({ title: 'Imóvel Secreto A' }))).body;
    const deal = (await A.admin.post('/api/deals', { person_id: person.id, property_ids: [prop.id] })).body;
    const t0 = Date.now() + 86400_000;
    const ev = (await A.admin.post('/api/events', { type: 'visita', title: 'Evento A', starts_at: new Date(t0).toISOString(), ends_at: new Date(t0 + 3600_000).toISOString() })).body;
    const a = B.admin;
    // leitura direta por ID
    for (const url of [`/api/people/${person.id}`, `/api/properties/${prop.id}`, `/api/deals/${deal.id}`, `/api/events/${ev.id}`, `/api/people/${person.id}/matches`, `/api/properties/${prop.id}/similar`]) {
      expect((await a.get(url)).status, url).toBe(404);
    }
    // listas e busca global não vazam
    expect((await a.get('/api/people')).body.total).toBe(0);
    expect((await a.get('/api/properties')).body.total).toBe(0);
    expect((await a.get('/api/deals')).body).toHaveLength(0);
    expect((await a.get('/api/events')).body).toHaveLength(0);
    const g = (await a.get('/api/search?q=Secreto')).body;
    expect(g.properties).toHaveLength(0);
    expect((await a.get('/api/search?q=Pessoa')).body.people).toHaveLength(0);
    // escrita cruzada
    expect((await a.patch(`/api/people/${person.id}`, { name: 'Hack' })).status).toBe(404);
    expect((await a.patch(`/api/properties/${prop.id}`, { title: 'Hack' })).status).toBe(404);
    expect((await a.del(`/api/properties/${prop.id}`)).status).toBe(404);
    expect((await a.post(`/api/deals/${deal.id}/stage`, { stage_key: 'qualificacao' })).status).toBe(404);
    expect((await a.post(`/api/events/${ev.id}/cancel`, {})).status).toBe(404);
    // não dá para referenciar registros de outra organização
    const mine = (await B.admin.post('/api/people', { name: 'Minha' })).body;
    expect((await a.post('/api/deals', { person_id: person.id })).status).toBe(400);
    expect((await a.post('/api/deals', { person_id: mine.id, property_ids: [prop.id] })).status).toBe(400);
    expect((await a.post('/api/properties', urbanHouse({ owner_person_id: person.id }))).status).toBe(400);
    expect((await a.post('/api/events', { type: 'visita', title: 'x', starts_at: new Date(t0).toISOString(), ends_at: new Date(t0 + 3600_000).toISOString(), person_id: person.id })).status).toBe(400);
    // nada foi alterado em A
    expect((await A.admin.get(`/api/people/${person.id}`)).body.name).toBe('Pessoa A');
    expect((await A.admin.get(`/api/properties/${prop.id}`)).body.title).toBe('Imóvel Secreto A');
    // usuários também são isolados
    const users = (await a.get('/api/users')).body;
    expect(users).toHaveLength(1);
  });
});

describe('permissões no servidor', () => {
  it('usuário de consulta só lê; assistente não vê relatórios gerenciais nem gerencia usuários', async () => {
    const { admin } = await newOrg(app);
    const consulta = await addUser(app, admin, 'consulta');
    const assistente = await addUser(app, admin, 'assistente');
    expect((await consulta.get('/api/people')).status).toBe(200);
    expect((await consulta.post('/api/people', { name: 'Não pode' })).status).toBe(403);
    expect((await consulta.post('/api/properties', urbanHouse())).status).toBe(403);
    expect((await consulta.post('/api/events', { type: 'outro', title: 'x', starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 3600_000).toISOString() })).status).toBe(403);
    expect((await consulta.get('/api/deals')).status).toBe(403);
    expect((await assistente.post('/api/invites', { email: 'x@y.com', role: 'corretor' })).status).toBe(403);
    expect((await assistente.get('/api/reports/captacao')).status).toBe(403);
    expect((await assistente.get('/api/reports/captacao/export.csv')).status).toBe(403);
    expect((await new Client(app).get('/api/people')).status).toBe(401); // sem sessão
    // usuário desativado perde acesso imediatamente
    const users = (await admin.get('/api/users')).body;
    const target = users.find((u: any) => u.role === 'consulta');
    await admin.patch(`/api/users/${target.id}`, { active: false });
    expect((await consulta.get('/api/people')).status).toBe(401);
  });
});

describe('painel e relatórios com dados reais', () => {
  it('painel vazio não inventa números; relatórios sinalizam falta de dados; CSV é protegido contra fórmula', async () => {
    const { admin } = await newOrg(app);
    const dash = (await admin.get('/api/dashboard')).body;
    expect(dash.today).toEqual([]);
    expect(dash.availableProperties).toBe(0);
    expect(dash.summary.open_deals).toBe(0);
    expect(dash.contractsExpiring.available).toBe(false); // Fase 2 — sem fingir
    const rep = (await admin.get('/api/reports/captacao')).body;
    expect(rep.insufficient).toBe(true);
    const tm = (await admin.get('/api/reports/tempo-medio')).body.rows[0];
    expect(tm.dias_medios_ate_fechar).toBeNull();
    // CSV
    await admin.post('/api/people', { name: '=HYPERLINK("http://x")', source: 'Site' });
    const csv = await admin.get('/api/reports/leads-origem/export.csv');
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.body).toContain('origem,total');
    const created = await admin.post('/api/people', { name: '+55 teste', source: '=cmd|calc' });
    expect(created.status).toBe(201);
    const csv2 = await admin.get('/api/reports/leads-origem/export.csv');
    expect(csv2.body).toContain("'=cmd|calc");
  });
  it('painel reflete a agenda de hoje e oportunidades reais', async () => {
    const { admin } = await newOrg(app);
    const person = (await admin.post('/api/people', { name: 'Cliente Hoje' })).body;
    await admin.post('/api/deals', { person_id: person.id, estimated_value: 300000 });
    const now = new Date();
    const s = new Date(now.getTime() + 60_000);
    await admin.post('/api/events?force=true', { type: 'reuniao', title: 'Reunião de hoje', starts_at: s.toISOString(), ends_at: new Date(s.getTime() + 1800_000).toISOString() });
    const dash = (await admin.get('/api/dashboard')).body;
    expect(dash.summary.open_deals).toBe(1);
    expect(dash.summary.open_estimated).toBe(300000);
    expect(dash.newContacts.map((p: any) => p.name)).toContain('Cliente Hoje');
  });
});

