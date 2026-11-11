import { describe, it, expect, beforeAll } from 'vitest';
import { newApp, newOrg, addUser, CPF_OK, CPF_OK_2 } from './helpers.js';
import { schedule } from '../src/routes/contractFinance.js';

let app: any;
beforeAll(async () => { app = await newApp(); });
const day = (n: number) => new Date(Date.now() - 3 * 3600_000 + n * 86400000).toISOString().slice(0, 10);

async function ativo(admin: any, extra: any = {}) {
  const prop = (await admin.post('/api/properties', { title: 'Casa Aluguel', kind: 'urbano', subtype: 'casa', purposes: ['aluguel'], price_rent: 2000, status: 'disponivel' })).body;
  const a = (await admin.post('/api/people', { kind: 'fisica', name: 'Dono', document: CPF_OK, phones: [], emails: [], roles: ['proprietario'] })).body;
  const b = (await admin.post('/api/people', { kind: 'fisica', name: 'Inquilino', document: CPF_OK_2, phones: [], emails: [], roles: ['locatario'] })).body;
  const c = (await admin.post('/api/contracts', { kind: 'locacao', property_id: prop.id, owner_person_id: a.id, counterparty_person_id: b.id, start_date: day(-70), end_date: day(295), value_amount: 2000, value_period: 'mensal', due_day: 5, adjustment_index: 'IGP-M', ...extra })).body;
  expect((await admin.post(`/api/contracts/${c.id}/activate`)).status).toBe(200);
  return { c, prop };
}

describe('Fase 11 — calendário de vencimentos', () => {
  it('mensal respeita o dia (limitado ao fim do mês), anual usa aniversários, safra uma parcela', () => {
    const m = schedule({ start_date: '2026-01-31', end_date: '2026-05-01', value_period: 'mensal', due_day: 31 });
    expect(m).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(schedule({ start_date: '2026-03-10', end_date: '2029-03-10', value_period: 'anual', due_day: null })).toEqual(['2026-03-10', '2027-03-10', '2028-03-10']);
    expect(schedule({ start_date: '2026-03-10', end_date: '2026-09-30', value_period: 'safra', due_day: null })).toEqual(['2026-09-30']);
    expect(schedule({ start_date: '2024-02-29', end_date: '2027-02-28', value_period: 'anual', due_day: null })).toEqual(['2024-02-29', '2025-02-28', '2026-02-28']);
  });
});

describe('Fase 11 — parcelas e pagamentos', () => {
  it('gera parcelas sem duplicar, baixa total/parcial, desfaz e calcula atraso', async () => {
    const { admin } = await newOrg(app, 'Fin');
    const { c } = await ativo(admin);
    const g1 = (await admin.post(`/api/contracts/${c.id}/payments/generate`)).body;
    expect(g1.created).toBeGreaterThanOrEqual(11); expect(g1.created).toBe(g1.total);
    expect((await admin.post(`/api/contracts/${c.id}/payments/generate`)).body.created).toBe(0); // idempotente
    const list = (await admin.get(`/api/contracts/${c.id}/payments`)).body;
    const vencidas = list.filter((p: any) => String(p.due_date).slice(0, 10) < day(0));
    expect(vencidas.length).toBeGreaterThanOrEqual(2);
    expect(vencidas.every((p: any) => p.status === 'atrasado')).toBe(true);
    // alerta de atraso e resumo
    expect((await admin.get('/api/contracts/alerts')).body.some((x: any) => x.type === 'pagamento_atrasado')).toBe(true);
    const sum = (await admin.get('/api/contract-payments/summary')).body;
    expect(sum.parcelas_atrasadas).toBe(vencidas.length); expect(Number(sum.em_atraso)).toBe(2000 * vencidas.length);
    // baixa parcial → parcial; baixa total → pago
    const p0 = vencidas[0];
    const par = (await admin.post(`/api/contract-payments/${p0.id}/pay`, { paid_amount: 500, paid_at: day(-1), method: 'pix' })).body;
    expect(par.status).toBe('parcial');
    expect((await admin.post(`/api/contract-payments/${p0.id}/pay`, { paid_amount: 2000, paid_at: day(-1), method: 'pix' })).body.status).toBe('pago');
    expect((await admin.del(`/api/contract-payments/${p0.id}`)).status).toBe(409); // pago não se exclui
    expect((await admin.post(`/api/contract-payments/${p0.id}/unpay`)).body.status).toBe('atrasado');
    // validações
    expect((await admin.post(`/api/contract-payments/${p0.id}/pay`, { paid_amount: 2000, paid_at: day(3) })).status).toBe(400); // futuro
    expect((await admin.post(`/api/contract-payments/${p0.id}/pay`, { paid_amount: 99999 })).status).toBe(400);
    expect((await admin.post(`/api/contract-payments/${p0.id}/pay`, { paid_amount: -5 })).status).toBe(400);
    // cobrança avulsa
    const extra = await admin.post(`/api/contracts/${c.id}/payments`, { due_date: day(10), amount: 150, note: 'Multa de chaves' });
    expect(extra.status).toBe(201);
    expect((await admin.del(`/api/contract-payments/${extra.body.id}`)).status).toBe(200);
  });

  it('permissões e isolamento entre imobiliárias', async () => {
    const A = await newOrg(app, 'FinA'); const B = await newOrg(app, 'FinB');
    const { c } = await ativo(A.admin);
    await A.admin.post(`/api/contracts/${c.id}/payments/generate`);
    const p = (await A.admin.get(`/api/contracts/${c.id}/payments`)).body[0];
    expect((await B.admin.get(`/api/contracts/${c.id}/payments`)).status).toBe(404);
    expect((await B.admin.post(`/api/contracts/${c.id}/payments/generate`)).status).toBe(404);
    expect((await B.admin.post(`/api/contract-payments/${p.id}/pay`, { paid_amount: 10 })).status).toBe(404);
    expect((await B.admin.del(`/api/contract-payments/${p.id}`)).status).toBe(404);
    expect((await B.admin.post(`/api/contracts/${c.id}/adjust`, { percent: 5, effective_date: day(0) })).status).toBe(404);
    expect((await B.admin.post(`/api/contracts/${c.id}/renew`, { new_end_date: day(900) })).status).toBe(404);
    expect(((await B.admin.get('/api/contract-payments/summary')).body.atrasadas as any[]).length).toBe(0);
    const asst = await addUser(app, A.admin, 'assistente');
    expect((await asst.get(`/api/contracts/${c.id}/payments`)).status).toBe(200);
    expect((await asst.post(`/api/contract-payments/${p.id}/pay`, { paid_amount: 10 })).status).toBe(403);
    expect((await asst.post(`/api/contracts/${c.id}/renew`, { new_end_date: day(900) })).status).toBe(403);
    const cons = await addUser(app, A.admin, 'consulta');
    expect((await cons.get(`/api/contracts/${c.id}/payments`)).status).toBe(403);
  });
});

describe('Fase 11 — reajuste e renovação', () => {
  it('reajusta valor e parcelas em aberto, preserva as pagas e guarda histórico', async () => {
    const { admin } = await newOrg(app, 'Adj');
    const { c } = await ativo(admin);
    await admin.post(`/api/contracts/${c.id}/payments/generate`);
    const before = (await admin.get(`/api/contracts/${c.id}/payments`)).body;
    const paga = before[0]; await admin.post(`/api/contract-payments/${paga.id}/pay`, { paid_amount: 2000, paid_at: day(-1) });
    expect((await admin.post(`/api/contracts/${c.id}/adjust`, { percent: 0, effective_date: day(0) })).status).toBe(400);
    expect((await admin.post(`/api/contracts/${c.id}/adjust`, { percent: 5, effective_date: day(-500) })).status).toBe(400); // fora do prazo
    const r = await admin.post(`/api/contracts/${c.id}/adjust`, { percent: 4.5, effective_date: day(0), note: 'IGP-M acumulado' });
    expect(r.status).toBe(200); expect(r.body.new_amount).toBe(2090); expect(r.body.old_amount).toBe(2000);
    expect((await admin.get(`/api/contracts/${c.id}`)).body.value_amount).toBe(2090);
    const after = (await admin.get(`/api/contracts/${c.id}/payments`)).body;
    expect(after.find((p: any) => p.id === paga.id).amount).toBe(2000);
    const futuras = after.filter((p: any) => String(p.due_date).slice(0, 10) >= day(0) && p.paid_amount == null);
    expect(futuras.length).toBeGreaterThan(5); expect(futuras.every((p: any) => p.amount === 2090)).toBe(true);
    const atrasadas = after.filter((p: any) => String(p.due_date).slice(0, 10) < day(0) && p.paid_amount == null);
    expect(atrasadas.every((p: any) => p.amount === 2000)).toBe(true); // vigência: só dali em diante
    const hist = (await admin.get(`/api/contracts/${c.id}/adjustments`)).body;
    expect(hist.length).toBe(1); expect(hist[0].index_name).toBe('IGP-M'); expect(hist[0].percent).toBe(4.5);
  });

  it('renova: encerra o atual, cria o novo ativo ligado ao anterior, mantém o imóvel alugado', async () => {
    const { admin } = await newOrg(app, 'Ren');
    const { c, prop } = await ativo(admin);
    expect((await admin.post(`/api/contracts/${c.id}/renew`, { new_end_date: day(100) })).status).toBe(400); // não passa do fim atual
    expect((await admin.post(`/api/contracts/${c.id}/renew`, { new_end_date: day(900), percent: 5, value_amount: 3000 })).status).toBe(400);
    const r = await admin.post(`/api/contracts/${c.id}/renew`, { new_end_date: day(660), percent: 10 });
    expect(r.status).toBe(201); expect(r.body.value_amount).toBe(2200); expect(r.body.parcelas).toBeGreaterThan(10);
    const old = (await admin.get(`/api/contracts/${c.id}`)).body;
    expect(old.status).toBe('encerrado'); expect(old.closed_reason).toBe('Renovado');
    const nw = (await admin.get(`/api/contracts/${r.body.id}`)).body;
    expect(nw.status).toBe('ativo'); expect(nw.renewed_from).toBe(c.id); expect(String(nw.start_date).slice(0, 10)).toBe(String(old.end_date).slice(0, 10));
    expect((await admin.get(`/api/properties/${prop.id}`)).body.status).toBe('alugado');
    expect((await admin.post(`/api/contracts/${c.id}/renew`, { new_end_date: day(900) })).status).toBe(409); // já encerrado
    expect(((await admin.get(`/api/contracts/${r.body.id}/payments`)).body as any[]).length).toBe(r.body.parcelas);
  });
});
