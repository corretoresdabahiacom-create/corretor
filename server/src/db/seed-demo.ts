// DADOS DE DEMONSTRAÇÃO — fictícios, criados numa organização separada ("Demo ...").
// Nunca roda em produção. Login: demo@imobflow.local / demo-senha-123
import { buildApp } from '../app.js';
if (process.env.NODE_ENV === 'production') throw new Error('seed:demo não roda em produção.');
const app = await buildApp();
let cookie = '';
const call = async (method: string, url: string, payload?: any) => {
  const r = await app.inject({ method: method as any, url, payload, headers: { cookie, origin: 'http://localhost:5173' } });
  const sc = r.headers['set-cookie']; if (sc) cookie = String(Array.isArray(sc) ? sc[0] : sc).split(';')[0];
  if (r.statusCode >= 400) throw new Error(`${method} ${url} -> ${r.statusCode} ${r.body}`);
  return r.json();
};
await call('POST', '/api/auth/register', { orgName: 'Demo Imobiliária (fictícia)', name: 'Demo Admin', email: 'demo@imobflow.local', password: 'demo-senha-123' });
const dono = await call('POST', '/api/people', { kind: 'fisica', name: 'Maria Demo (fictícia)', roles: ['proprietario'], phones: ['11999990001'], emails: ['maria@exemplo.invalid'], consent: { contact_ok: true } });
const cli = await call('POST', '/api/people', { kind: 'fisica', name: 'João Demo (fictício)', roles: ['comprador'], phones: ['11999990002'], emails: [], consent: { contact_ok: true } });
await call('POST', '/api/properties', { title: 'Apartamento 2 quartos (demo)', kind: 'urbano', subtype: 'apartamento', purposes: ['venda'], price_sale: 450000, area_total: 70, bedrooms: 2, address: { cidade: 'Exemplo', uf: 'SP' }, owner_person_id: dono.id, status: 'disponivel' });
await call('POST', '/api/properties', { title: 'Sítio 12 ha com represa (demo)', kind: 'rural', subtype: 'sitio', purposes: ['venda', 'arrendamento'], price_sale: 1200000, price_lease: 60000, area_total: 12, area_unit: 'ha', address: { cidade: 'Exemplo', uf: 'MG' }, owner_person_id: dono.id, status: 'disponivel' });
await call('POST', '/api/properties', { title: 'Casa a 200 m da praia (demo)', kind: 'urbano', subtype: 'casa', location_tags: ['litoral'], purposes: ['venda'], price_sale: 980000, area_total: 180, bedrooms: 3, address: { cidade: 'Exemplo', uf: 'SC' }, status: 'disponivel' });
console.log('Demo criada. Cliente de exemplo:', cli.id);
await app.close();
