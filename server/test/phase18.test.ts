// Fase 18 — sugestão de reajuste por índice oficial (Banco Central), com a API simulada.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { newApp, newOrg, CPF_OK, CPF_OK_2 } from './helpers.js';
import { q } from '../src/db/pool.js';
import { accumulate, normalizeIndex, parseSgs } from '../src/lib/indices.js';

let app: any;
beforeAll(async () => { app = await newApp(); });
afterEach(() => vi.restoreAllMocks());
const day = (n: number) => new Date(Date.now() - 3 * 3600_000 + n * 86400000).toISOString().slice(0, 10);

async function contrato(admin: any, adjustment_index: string | null) {
  const prop = (await admin.post('/api/properties', { title: 'Casa', kind: 'urbano', subtype: 'casa', purposes: ['aluguel'], price_rent: 2000, status: 'disponivel' })).body;
  const a = (await admin.post('/api/people', { kind: 'fisica', name: 'Dono', document: CPF_OK, phones: [], emails: [], roles: ['proprietario'] })).body;
  const b = (await admin.post('/api/people', { kind: 'fisica', name: 'Inquilino', document: CPF_OK_2, phones: [], emails: [], roles: ['locatario'] })).body;
  return (await admin.post('/api/contracts', { kind: 'locacao', property_id: prop.id, owner_person_id: a.id, counterparty_person_id: b.id, start_date: day(-70), end_date: day(295), value_amount: 2000, value_period: 'mensal', due_day: 5, adjustment_index })).body;
}
const sgs = (from: string, n: number, v: number) => Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1 + i, 1)); return { data: `01/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`, valor: String(v) }; });

describe('funções puras', () => {
  it('reconhece o índice pelo nome', () => {
    expect(normalizeIndex('IGP-M')).toBe('IGPM'); expect(normalizeIndex('igpm acumulado')).toBe('IGPM');
    expect(normalizeIndex('IPCA/IBGE')).toBe('IPCA'); expect(normalizeIndex('IGP-DI')).toBe('IGPDI'); expect(normalizeIndex('INPC')).toBe('INPC');
    expect(normalizeIndex('a combinar')).toBeNull(); expect(normalizeIndex(null)).toBeNull();
  });
  it('lê o formato do SGS e descarta linhas inválidas', () => {
    expect(parseSgs([{ data: '01/03/2025', valor: '0.43' }, { data: 'x', valor: '1' }, { data: '01/04/2025', valor: 'abc' }, { data: '01/05/2025', valor: '999' }, { data: '01/06/2025', valor: '-0,2' }]))
      .toEqual([{ month: '2025-03-01', percent: 0.43 }, { month: '2025-06-01', percent: -0.2 }]);
    expect(parseSgs({ erro: 1 })).toEqual([]);
  });
  it('acumula composto em 12 meses e acusa meses faltando', () => {
    const m = new Map<string, number>(); for (let i = 1; i <= 12; i++) m.set(`2025-${String(i).padStart(2, '0')}-01`, 1);
    const a = accumulate(m, '2025-12-01'); expect(a.complete).toBe(true); expect(a.percent).toBeCloseTo(12.6825, 3);
    m.delete('2025-05-01'); const b = accumulate(m, '2025-12-01'); expect(b.complete).toBe(false); expect(b.missing).toEqual(['2025-05-01']);
  });
});

describe('sugestão de reajuste', () => {
  it('busca no BCB, guarda e devolve o acumulado dos 12 meses anteriores à vigência', async () => {
    await q(`DELETE FROM economic_indices WHERE series='IGPM'`); await q(`DELETE FROM economic_indices_sync WHERE series='IGPM'`);
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(sgs('2023-01', 48, 0.5)), { status: 200 }));
    const { admin } = await newOrg(app, 'Idx'); const c = await contrato(admin, 'IGP-M');
    const r = await admin.get(`/api/contracts/${c.id}/adjust-suggestion?effective_date=2026-03-10`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ index: 'IGPM', complete: true, stale: false, from: '2025-03-01', to: '2026-02-01' });
    expect(r.body.percent).toBeCloseTo((Math.pow(1.005, 12) - 1) * 100, 3);
    expect(r.body.source).toContain('SGS 189');
    expect(String(f.mock.calls[0][0])).toContain('bcdata.sgs.189');
    const again = await admin.get(`/api/contracts/${c.id}/adjust-suggestion?effective_date=2026-03-10`);
    expect(again.status).toBe(200); expect(f).toHaveBeenCalledTimes(1); // dados em dia: não consulta de novo
  });

  it('BCB fora do ar e sem dados guardados: responde sugestão incompleta, sem erro 500', async () => {
    await q(`DELETE FROM economic_indices WHERE series='IPCA'`); await q(`DELETE FROM economic_indices_sync WHERE series='IPCA'`);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('rede indisponível'));
    const { admin } = await newOrg(app, 'IdxOff'); const c = await contrato(admin, 'IPCA');
    const r = await admin.get(`/api/contracts/${c.id}/adjust-suggestion?effective_date=2026-03-10`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ index: 'IPCA', complete: false, stale: true });
    expect(r.body.error).toContain('rede indisponível');
    expect(r.body.missing.length).toBe(12);
  });

  it('dados parciais não são tratados como completos', async () => {
    await q(`DELETE FROM economic_indices WHERE series='INPC'`); await q(`DELETE FROM economic_indices_sync WHERE series='INPC'`);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(sgs('2025-06', 5, 0.3)), { status: 200 }));
    const { admin } = await newOrg(app, 'IdxPar'); const c = await contrato(admin, 'INPC');
    const r = await admin.get(`/api/contracts/${c.id}/adjust-suggestion?effective_date=2026-03-10`);
    expect(r.body.complete).toBe(false); expect(r.body.missing.length).toBeGreaterThan(0);
  });

  it('índice desconhecido: 422 com a lista; troca de índice por parâmetro; outro contrato de outra org: 404', async () => {
    const { admin } = await newOrg(app, 'IdxX'); const c = await contrato(admin, 'a combinar');
    const r = await admin.get(`/api/contracts/${c.id}/adjust-suggestion?effective_date=2026-03-10`);
    expect(r.status).toBe(422); expect(r.body.indices.length).toBe(4);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('x'));
    expect((await admin.get(`/api/contracts/${c.id}/adjust-suggestion?effective_date=2026-03-10&index=IPCA`)).status).toBe(200);
    expect((await admin.get(`/api/contracts/${c.id}/adjust-suggestion?effective_date=data-ruim`)).status).toBe(400);
    const { admin: outro } = await newOrg(app, 'IdxOutro');
    expect((await outro.get(`/api/contracts/${c.id}/adjust-suggestion?effective_date=2026-03-10`)).status).toBe(404);
  });

  it('atualização manual informa o resultado de cada índice', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(sgs('2025-01', 12, 0.4)), { status: 200 }));
    const { admin } = await newOrg(app, 'IdxRef');
    const r = await admin.post('/api/indices/refresh', {});
    expect(r.status).toBe(200); expect(r.body.IGPM).toMatchObject({ ok: true, meses: 12 }); expect(Object.keys(r.body).sort()).toEqual(['IGPDI', 'IGPM', 'INPC', 'IPCA']);
  });
});
