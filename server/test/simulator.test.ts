// Fase 17 — simulador de financiamento na página pública do imóvel à venda.
import { describe, it, expect, beforeAll } from 'vitest';
import { newApp, newOrg, uniq } from './helpers.js';
import { SIM_CALC } from '../src/lib/siteRender.js';

let app: any;
beforeAll(async () => { app = await newApp(); });

const simCalc = new Function(`${SIM_CALC}; return simCalc;`)() as (pv: number, anos: number, taxaAno: number, sist: string) => { first: number; last: number; total: number } | null;
const page = async (url: string) => (await app.inject({ method: 'GET', url })).body as string;
const slugOf = async (admin: any) => (await admin.get('/api/brand')).body.vitrine_url.split('/v/')[1].replace(/\?.*/, '');
async function pub(admin: any, extra: any) {
  const p = (await admin.post('/api/properties', { title: 'Imóvel Sim ' + uniq(), kind: 'urbano', subtype: 'apartamento', purposes: ['venda'], price_sale: 300000, status: 'disponivel', publish_authorized: true, address: { logradouro: 'Rua A', cidade: 'Salvador', uf: 'BA' }, ...extra })).body;
  expect((await admin.post(`/api/properties/${p.id}/publish`)).status).toBe(200);
  return (await admin.get(`/api/properties/${p.id}`)).body.public_code as string;
}

describe('cálculo', () => {
  const anual = (Math.pow(1.01, 12) - 1) * 100; // 1% ao mês efetivo
  it('Price: igual à fórmula PMT (100 mil, 12 meses, 1% a.m. → R$ 8.884,88)', () => {
    const r = simCalc(100000, 1, anual, 'price')!;
    expect(r.first).toBeCloseTo(8884.88, 2);
    expect(r.last).toBeCloseTo(r.first, 6);
    expect(r.total).toBeCloseTo(8884.88 * 12, 0);
  });
  it('SAC: 120 mil em 12 meses a 1% a.m. → 1ª 11.200, última 10.100, total 127.800', () => {
    const r = simCalc(120000, 1, anual, 'sac')!;
    expect(r.first).toBeCloseTo(11200, 4);
    expect(r.last).toBeCloseTo(10100, 4);
    expect(r.total).toBeCloseTo(127800, 4);
  });
  it('juros zero e entradas inválidas', () => {
    expect(simCalc(120000, 10, 0, 'price')!.first).toBeCloseTo(1000, 6);
    expect(simCalc(0, 30, 12, 'sac')).toBeNull();
    expect(simCalc(100000, 0, 12, 'sac')).toBeNull();
    expect(simCalc(100000, 30, -1, 'sac')).toBeNull();
    expect(simCalc(100000, 30, NaN, 'price')).toBeNull();
  });
});

describe('página do imóvel', () => {
  it('aparece só para venda com preço visível; script compila; entrada sugerida de 20%', async () => {
    const { admin } = await newOrg(app, 'Sim'); const slug = await slugOf(admin);
    const venda = await pub(admin, {});
    const html = await page(`/v/${slug}/imovel/${venda}`);
    expect(html).toContain('id="sim"');
    expect(html).toContain('data-price="300000"');
    expect(html).toContain('value="60.000"');
    expect(html).toContain('Estimativa sem seguros');
    const scripts = [...html.matchAll(/<script(?![^>]*(?:src=|ld\+json))[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts.some((s) => s.includes('simCalc'))).toBe(true);
    for (const code of scripts) expect(() => new Function(code)).not.toThrow();

    const aluguel = await pub(admin, { purposes: ['aluguel'], price_sale: null, price_rent: 2500 });
    expect(await page(`/v/${slug}/imovel/${aluguel}`)).not.toContain('id="sim"');
    const oculto = await pub(admin, { show_price: false });
    const h2 = await page(`/v/${slug}/imovel/${oculto}`);
    expect(h2).not.toContain('id="sim"');
    expect(h2).not.toContain('300000');
  });
});
