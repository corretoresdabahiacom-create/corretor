import type { FastifyInstance } from 'fastify';
import { q } from '../src/db/pool.js';
import { buildApp } from '../src/app.js';

export class Client {
  cookie = '';
  constructor(public app: FastifyInstance) {}
  async req(method: string, url: string, payload?: unknown) {
    const res = await this.app.inject({
      method: method as any, url, payload: payload as any,
      headers: { cookie: this.cookie, ...(payload !== undefined ? { 'content-type': 'application/json' } : {}) },
    });
    const sc = res.headers['set-cookie'];
    if (sc) {
      const raw = (Array.isArray(sc) ? sc : [sc])[0].split(';')[0];
      this.cookie = raw.endsWith('=') ? '' : raw;
    }
    let body: any = res.body;
    try { body = JSON.parse(res.body); } catch { /* texto/CSV */ }
    return { status: res.statusCode, body, headers: res.headers };
  }
  get = (u: string) => this.req('GET', u);
  post = (u: string, b: unknown = {}) => this.req('POST', u, b);
  patch = (u: string, b: unknown) => this.req('PATCH', u, b);
  put = (u: string, b: unknown = {}) => this.req('PUT', u, b);
  del = (u: string) => this.req('DELETE', u);
}

let counter = 0;
export const uniq = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export async function newApp() {
  return buildApp({ logger: false, rateLimit: false });
}

/** Cria uma imobiliária + admin e devolve um cliente já autenticado. */
export async function newOrg(app: FastifyInstance, label = 'Imob', plan: string = 'ilimitado') {
  const c = new Client(app);
  const email = `admin-${uniq()}@teste.dev`;
  const r = await c.post('/api/auth/register', { orgName: `${label} ${uniq()}`, name: `Admin ${label}`, email, password: 'senhaSegura123' });
  if (r.status !== 201) throw new Error('register falhou: ' + JSON.stringify(r.body));
  if (plan !== 'gratuito') await q('UPDATE organizations SET plan=$2 WHERE id=(SELECT org_id FROM users WHERE email=$1)', [email, plan]);
  return { admin: c, email };
}

/** Convida e aceita um usuário com o papel informado; devolve cliente autenticado. */
export async function addUser(app: FastifyInstance, admin: Client, role: 'gestor' | 'corretor' | 'assistente' | 'consulta') {
  const email = `${role}-${uniq()}@teste.dev`;
  const inv = await admin.post('/api/invites', { email, role });
  const token = inv.body.link.split('/convite/')[1];
  const c = new Client(app);
  const r = await c.post('/api/invites/accept', { token, name: `User ${role}`, password: 'senhaSegura123' });
  if (r.status !== 201) throw new Error('accept falhou: ' + JSON.stringify(r.body));
  return c;
}

// CPF/CNPJ válidos para testes
export const CPF_OK = '529.982.247-25';
export const CPF_OK_2 = '111.444.777-35';
export const CNPJ_OK = '11.222.333/0001-81';
