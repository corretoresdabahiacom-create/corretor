// Fase 19 — modelos de contrato e histórico de contratos na pasta do cliente.
import { describe, it, expect, beforeAll } from 'vitest';
import { newApp, newOrg, addUser, Client, CPF_OK, CPF_OK_2, uniq } from './helpers.js';
import { q1 } from '../src/db/pool.js';
import { TEMPLATES, defaults, numeroExtenso, reaisExtenso, dataExtenso } from '../src/lib/docTemplates.js';

let app: any;
beforeAll(async () => { app = await newApp(); });

const pessoa = async (c: Client, name = 'Maria da Silva', doc = CPF_OK, roles = ['proprietario']) =>
  (await c.post('/api/people', { kind: 'fisica', name, document: doc, phones: ['7199' + String(Math.floor(Math.random() * 9e6) + 1e6)], emails: [`p${uniq()}@teste.dev`], roles, address: { logradouro: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'Salvador', uf: 'BA' } })).body;
const imovel = async (c: Client, extra: any = {}) =>
  (await c.post('/api/properties', { title: 'Casa Azul', kind: 'urbano', subtype: 'casa', purposes: ['venda', 'aluguel'], price_sale: 450000, price_rent: 2500, status: 'disponivel', address: { logradouro: 'Rua B', numero: '20', cidade: 'Salvador', uf: 'BA' }, area_total: 120, ...extra })).body;

describe('valores por extenso', () => {
  it('números, reais e datas', () => {
    expect(numeroExtenso(101)).toBe('cento e um'); expect(numeroExtenso(1200000)).toBe('um milhão e duzentos mil');
    expect(numeroExtenso(21345)).toBe('vinte e um mil trezentos e quarenta e cinco');
    expect(reaisExtenso(2500)).toBe('dois mil e quinhentos reais'); expect(reaisExtenso(1)).toBe('um real'); expect(reaisExtenso(1000000)).toBe('um milhão de reais');
    expect(reaisExtenso(10.5)).toBe('dez reais e cinquenta centavos');
    expect(dataExtenso('2026-11-18')).toBe('18 de novembro de 2026'); expect(dataExtenso('')).toContain('____');
  });
});

describe('modelos', () => {
  it('todos geram texto completo, sem sobras de código, com assinatura e foro', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(10);
    const cats = new Set(TEMPLATES.map((t) => t.category));
    for (const c of ['corretagem', 'locacao', 'venda', 'arrendamento', 'avaliacao']) expect(cats.has(c as any)).toBe(true);
    for (const t of TEMPLATES) {
      const txt = t.build(defaults(t, { a_nome: 'Fulano', corretor_nome: 'Corretor X', data: '2026-11-18' }));
      expect(txt, t.key).not.toMatch(/undefined|\[object|NaN|\{\{/);
      expect(txt, t.key).toContain('CLÁUSULA 1ª'); expect(txt, t.key).toContain('Foro'.toUpperCase());
      expect(new Set(t.fields.map((f) => f.key)).size, t.key).toBe(t.fields.length); // sem campo repetido
      expect(t.warnings.length, t.key).toBeGreaterThan(0);
    }
  });
  it('corretagem inclui autorização de divulgação em redes sociais e sites', () => {
    for (const k of ['corretagem_venda', 'corretagem_locacao', 'corretagem_arrendamento']) {
      const t = TEMPLATES.find((x) => x.key === k)!; const txt = t.build(defaults(t));
      expect(txt).toMatch(/AUTORIZA, por escrito, a divulgação/); expect(txt).toContain('redes sociais'); expect(txt).toContain('portais imobiliários');
    }
  });
  it('opções mudam o texto (exclusividade, garantia, endereço)', () => {
    const v = TEMPLATES.find((x) => x.key === 'corretagem_venda')!;
    expect(v.build(defaults(v, { exclusividade: 'sim' }))).toContain('COM EXCLUSIVIDADE');
    expect(v.build(defaults(v, { exclusividade: 'nao' }))).toContain('SEM EXCLUSIVIDADE');
    expect(v.build(defaults(v, { divulgar_endereco: 'sim' }))).toContain('endereço exato poderá ser divulgado');
    const l = TEMPLATES.find((x) => x.key === 'locacao_residencial')!;
    expect(l.build(defaults(l, { garantia: 'fiador', garantia_detalhe: 'João' }))).toContain('FIANÇA');
    expect(l.build(defaults(l, { garantia: 'nenhuma' }))).toContain('SEM GARANTIA');
    expect(l.build(defaults(l, { inicio: '2026-12-01', meses: '30' }))).toContain('31 de maio de 2029');
  });
});

describe('histórico de contratos na pasta do cliente', () => {
  it('lista modelos, cria preenchido, edita, versiona, copia, compartilha e exclui', async () => {
    const { admin } = await newOrg(app, 'Docs');
    const cat = await admin.get('/api/doc-templates');
    expect(cat.status).toBe(200); expect(cat.body.fontes.length).toBeGreaterThan(0); expect(cat.body.modelos.length).toBeGreaterThanOrEqual(10);
    const p = await pessoa(admin); const im = await imovel(admin);

    const r = await admin.post(`/api/people/${p.id}/contract-docs`, { template_key: 'corretagem_venda', property_id: im.id, data: { comissao: '6', prazo_dias: '120' } });
    expect(r.status).toBe(201);
    expect(r.body.body).toContain('MARIA DA SILVA'); expect(r.body.body).toContain('529.982.247-25'); expect(r.body.body).toContain('Rua A, 10');
    expect(r.body.body).toContain('Casa Azul'); expect(r.body.body).toContain('R$ 450.000,00 (quatrocentos e cinquenta mil reais)'); expect(r.body.body).toContain('120 dias');
    expect(r.body.body).toContain('6% (seis por cento)'); expect(r.body.status).toBe('rascunho');
    const id = r.body.id;

    const list = await admin.get(`/api/people/${p.id}/contract-docs`);
    expect(list.body.length).toBe(1); expect(list.body[0]).toMatchObject({ id, status: 'rascunho', property_title: 'Casa Azul' }); expect(list.body[0].body).toBeUndefined();

    // alterar texto: guarda a versão anterior
    const antes = r.body.body;
    expect((await admin.patch(`/api/contract-docs/${id}`, { body: antes + '\n\nCláusula extra: teste.' })).status).toBe(200);
    let d = (await admin.get(`/api/contract-docs/${id}`)).body;
    expect(d.body).toContain('Cláusula extra'); expect(d.versions.length).toBe(1);
    // restaurar a anterior
    expect((await admin.post(`/api/contract-docs/${id}/restore`, { version_id: d.versions[0].id })).status).toBe(200);
    d = (await admin.get(`/api/contract-docs/${id}`)).body; expect(d.body).toBe(antes); expect(d.versions.length).toBe(2);
    // regenerar a partir dos campos
    const reg = await admin.patch(`/api/contract-docs/${id}`, { data: { prazo_dias: '45' }, regenerate: true });
    expect(reg.body.body).toContain('45 dias'); expect(reg.body.body).not.toContain('120 dias');

    // finalizar trava edição; reabrir libera
    expect((await admin.patch(`/api/contract-docs/${id}`, { status: 'finalizado' })).status).toBe(200);
    expect((await admin.patch(`/api/contract-docs/${id}`, { body: 'x' })).status).toBe(409);
    expect((await admin.patch(`/api/contract-docs/${id}`, { status: 'rascunho' })).status).toBe(200);

    // copiar para outro cliente
    const p2 = await pessoa(admin, 'João Souza', CPF_OK_2, ['comprador']);
    const cp = await admin.post(`/api/contract-docs/${id}/copy`, { person_id: p2.id });
    expect(cp.status).toBe(201); expect(cp.body.title).toMatch(/^Cópia de /); expect(cp.body.status).toBe('rascunho'); expect(cp.body.person_id).toBe(p2.id);
    expect((await admin.get(`/api/people/${p2.id}/contract-docs`)).body.length).toBe(1);

    // compartilhar por link com validade; só o hash fica no banco
    const sh = await admin.post(`/api/contract-docs/${id}/shares`, { days: 3 });
    expect(sh.status).toBe(201); expect(sh.body.url).toMatch(/\/d\/[A-Za-z0-9_-]{30,}$/);
    const token = sh.body.url.split('/d/')[1];
    expect(await q1('SELECT 1 FROM contract_doc_shares WHERE token_hash=$1', [token])).toBeNull();
    const pubPage = await new Client(app).get(`/d/${token}`);
    expect(pubPage.status).toBe(200); expect(String(pubPage.body)).toContain('MARIA DA SILVA'); expect(String(pubPage.body)).toContain('RASCUNHO');
    expect(pubPage.headers['x-robots-tag']).toContain('noindex'); expect(pubPage.headers['cache-control']).toContain('no-store');
    expect((await admin.get(`/api/contract-docs/${id}`)).body.shares[0].views).toBe(1);
    expect((await admin.del(`/api/contract-docs/${id}/shares/${sh.body.id}`)).status).toBe(200);
    expect((await new Client(app).get(`/d/${token}`)).status).toBe(404);
    expect((await new Client(app).get('/d/token-que-nao-existe-123456789')).status).toBe(404);

    // excluir
    expect((await admin.del(`/api/contract-docs/${id}`)).status).toBe(200);
    expect((await admin.get(`/api/contract-docs/${id}`)).status).toBe(404);
    expect((await admin.get(`/api/people/${p.id}/contract-docs`)).body.length).toBe(0);
  });

  it('locação: cliente locatário recebe o proprietário do imóvel no outro lado; contrato ativo preenche prazo e valor', async () => {
    const { admin } = await newOrg(app, 'DocsLoc');
    const dono = await pessoa(admin, 'Dono Casa', CPF_OK); const inq = await pessoa(admin, 'Inquilino Teste', CPF_OK_2, ['locatario']);
    const im = await imovel(admin, { owner_person_id: dono.id });
    const r = await admin.post(`/api/people/${inq.id}/contract-docs`, { template_key: 'locacao_residencial', side: 'b', property_id: im.id, data: { inicio: '2026-12-01', garantia: 'fiador', garantia_detalhe: 'Fiador Zé, CPF 000' } });
    expect(r.status).toBe(201);
    expect(r.body.body).toContain('DONO CASA, '); expect(r.body.body).toContain('INQUILINO TESTE, '); expect(r.body.body).toContain('R$ 2.500,00 (dois mil e quinhentos reais)'); expect(r.body.body).toContain('FIANÇA');
  });

  it('só administrador, gestor e corretor acessam; assistente e consulta não; outra imobiliária não vê', async () => {
    const { admin } = await newOrg(app, 'DocsPerm'); const p = await pessoa(admin);
    const corretor = await addUser(app, admin, 'corretor'); const gestor = await addUser(app, admin, 'gestor');
    const assistente = await addUser(app, admin, 'assistente'); const consulta = await addUser(app, admin, 'consulta');
    const r = await corretor.post(`/api/people/${p.id}/contract-docs`, { template_key: 'avaliacao_imovel' });
    expect(r.status).toBe(201); expect((await gestor.get(`/api/contract-docs/${r.body.id}`)).status).toBe(200);
    for (const c of [assistente, consulta]) {
      expect((await c.get(`/api/people/${p.id}/contract-docs`)).status).toBe(403);
      expect((await c.get(`/api/contract-docs/${r.body.id}`)).status).toBe(403);
      expect((await c.get('/api/doc-templates')).status).toBe(403);
      expect((await c.post(`/api/people/${p.id}/contract-docs`, { template_key: 'compra_venda' })).status).toBe(403);
    }
    const { admin: outro } = await newOrg(app, 'DocsOutro');
    expect((await outro.get(`/api/contract-docs/${r.body.id}`)).status).toBe(404);
    expect((await outro.del(`/api/contract-docs/${r.body.id}`)).status).toBe(404);
    expect((await outro.post(`/api/contract-docs/${r.body.id}/copy`, {})).status).toBe(404);
    expect((await outro.get(`/api/people/${p.id}/contract-docs`)).status).toBe(404);
    expect((await new Client(app).get(`/api/contract-docs/${r.body.id}`)).status).toBe(401);
  });

  it('modelo inexistente, imóvel de outra org e anonimização apaga os documentos', async () => {
    const { admin } = await newOrg(app, 'DocsAnon'); const p = await pessoa(admin);
    expect((await admin.post(`/api/people/${p.id}/contract-docs`, { template_key: 'nao_existe' })).status).toBe(400);
    const { admin: outro } = await newOrg(app, 'DocsOutro2'); const imOutro = await imovel(outro);
    expect((await admin.post(`/api/people/${p.id}/contract-docs`, { template_key: 'compra_venda', property_id: imOutro.id })).status).toBe(404);
    const r = await admin.post(`/api/people/${p.id}/contract-docs`, { template_key: 'compra_venda' });
    expect(r.status).toBe(201);
    const exp = await admin.get(`/api/people/${p.id}/export`);
    expect(exp.body.documentos_de_contrato.length).toBe(1);
    expect((await admin.post(`/api/people/${p.id}/anonymize`, { confirm: 'ANONIMIZAR' })).status).toBe(200);
    expect((await admin.get(`/api/contract-docs/${r.body.id}`)).status).toBe(404);
  });
});
