// Camada HTTP mínima, compatível com o trecho da API do Fastify que o projeto usa (get/post/patch/put/delete,
// preHandler, req/reply, cookies, multipart, rate limit por rota, inject). Baseada em Request/Response padrão,
// por isso roda igual em Node e em Cloudflare Workers (o Fastify não roda no Workers: o roteador usa `new Function`).
import { Buffer } from 'node:buffer';

export type Hook = (req: HttpRequest, reply: HttpReply) => unknown | Promise<unknown>;
export type RouteOpts = { preHandler?: Hook | Hook[]; config?: { rateLimit?: boolean | { max: number; timeWindow: string | number } } };
export type Handler = (req: HttpRequest, reply: HttpReply) => unknown | Promise<unknown>;
export type CookieOpts = { httpOnly?: boolean; secure?: boolean; sameSite?: 'lax' | 'strict' | 'none' | boolean; path?: string; domain?: string; expires?: Date; maxAge?: number };

export interface HttpRequest {
  method: string; url: string; params: unknown; query: unknown; body: unknown;
  headers: Record<string, string | undefined>; cookies: Record<string, string | undefined>; ip: string;
  log: { info(...a: unknown[]): void; warn(...a: unknown[]): void; error(...a: unknown[]): void };
  file(opts?: { limits?: { fileSize?: number } }): Promise<FilePart | undefined>;
}
export type FilePart = { filename: string; mimetype: string; fields: Record<string, any>; file: { truncated: boolean }; toBuffer(): Promise<Buffer> };

export class HttpReply {
  statusCode = 200; sent = false;
  headers = new Headers();
  payload: unknown = undefined;
  private cookies: string[] = [];
  code(n: number) { this.statusCode = n; return this; }
  status(n: number) { return this.code(n); }
  header(k: string, v: string | number) { this.headers.set(k, String(v)); return this; }
  type(t: string) { this.headers.set('content-type', t); return this; }
  getHeader(k: string) { return this.headers.get(k) ?? undefined; }
  setCookie(name: string, value: string, o: CookieOpts = {}) { this.cookies.push(serializeCookie(name, value, o)); return this; }
  clearCookie(name: string, o: CookieOpts = {}) { this.cookies.push(serializeCookie(name, '', { ...o, expires: new Date(0), maxAge: undefined })); return this; }
  send(p?: unknown) { if (!this.sent) { this.sent = true; this.payload = p; } return this; }
  toResponse(): Response {
    const h = new Headers(this.headers);
    for (const c of this.cookies) h.append('set-cookie', c);
    const p = this.payload; let body: BodyInit | null = null;
    if (p instanceof Uint8Array) { body = p as any; if (!h.has('content-type')) h.set('content-type', 'application/octet-stream'); }
    else if (typeof p === 'string') { body = p; if (!h.has('content-type')) h.set('content-type', 'text/plain; charset=utf-8'); }
    else if (p !== undefined) { body = JSON.stringify(p); if (!h.has('content-type')) h.set('content-type', 'application/json; charset=utf-8'); }
    if ([101, 204, 205, 304].includes(this.statusCode)) body = null;
    return new Response(body, { status: this.statusCode, headers: h });
  }
}

function serializeCookie(name: string, value: string, o: CookieOpts) {
  let s = `${name}=${encodeURIComponent(value)}`;
  if (o.maxAge != null) s += `; Max-Age=${Math.floor(o.maxAge)}`;
  if (o.domain) s += `; Domain=${o.domain}`;
  s += `; Path=${o.path ?? '/'}`;
  if (o.expires) s += `; Expires=${o.expires.toUTCString()}`;
  if (o.httpOnly) s += '; HttpOnly';
  if (o.secure) s += '; Secure';
  if (o.sameSite) s += `; SameSite=${o.sameSite === true ? 'Strict' : o.sameSite[0].toUpperCase() + o.sameSite.slice(1)}`;
  return s;
}

const parseCookies = (h: string | null) => {
  const out: Record<string, string> = {};
  for (const part of (h ?? '').split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    const k = part.slice(0, i).trim(); if (!k || k in out) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[k] = part.slice(i + 1).trim(); }
  }
  return out;
};

const windowMs = (w: string | number) => {
  if (typeof w === 'number') return w;
  const m = /^(\d+)\s*(second|minute|hour|day)s?$/.exec(w.trim()); if (!m) return 60_000;
  return Number(m[1]) * { second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000 }[m[2] as 'second'];
};

type Route = { method: string; keys: string[]; re: RegExp; opts: RouteOpts; handler: Handler; pattern: string };
export class HttpError extends Error { constructor(public statusCode: number, msg: string) { super(msg); } }

export type AppOptions = { logger?: unknown; bodyLimit?: number; trustProxy?: boolean; rateLimit?: boolean };
type Plugin = (app: HttpApp, opts?: any) => unknown | Promise<unknown>;

export class HttpApp {
  private routes: Route[] = [];
  private errorHandler: (err: any, req: HttpRequest, reply: HttpReply) => unknown = (err, _r, reply) => reply.code(err.statusCode ?? 500).send({ error: err.message });
  private notFound: Handler = (_r, reply) => reply.code(404).send({ error: 'Não encontrado.' });
  private onSend: Array<(req: HttpRequest, reply: HttpReply) => void> = [];
  private hits = new Map<string, { n: number; reset: number }>();
  log = { info: (..._a: unknown[]) => {}, warn: (..._a: unknown[]) => {}, error: (...a: unknown[]) => { if (process.env.LOG_ERRORS) console.error(...a); } };
  constructor(public opts: AppOptions = {}) {}

  private add(method: string, pattern: string, a: RouteOpts | Handler, b?: Handler) {
    const [opts, handler] = typeof a === 'function' ? [{} as RouteOpts, a] : [a, b!];
    const keys: string[] = [];
    const re = new RegExp('^' + pattern.replace(/[.+*?^${}()|[\]\\]/g, '\\$&').replace(/:([A-Za-z_]\w*)/g, (_m, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    this.routes.push({ method, keys, re, opts, handler, pattern });
  }
  get(p: string, a: RouteOpts | Handler, b?: Handler) { this.add('GET', p, a, b); }
  post(p: string, a: RouteOpts | Handler, b?: Handler) { this.add('POST', p, a, b); }
  put(p: string, a: RouteOpts | Handler, b?: Handler) { this.add('PUT', p, a, b); }
  patch(p: string, a: RouteOpts | Handler, b?: Handler) { this.add('PATCH', p, a, b); }
  delete(p: string, a: RouteOpts | Handler, b?: Handler) { this.add('DELETE', p, a, b); }
  async register(plugin: Plugin, opts?: any) { await plugin(this, opts); }
  setErrorHandler(fn: (err: any, req: HttpRequest, reply: HttpReply) => unknown) { this.errorHandler = fn; }
  setNotFoundHandler(fn: Handler) { this.notFound = fn; }
  /** Executado em toda resposta (ex.: cabeçalhos de segurança). */
  addSendHook(fn: (req: HttpRequest, reply: HttpReply) => void) { this.onSend.push(fn); }
  async ready() { return this; }
  async close() { /* nada a encerrar */ }

  private limited(r: Route, ip: string) {
    const rl = r.opts.config?.rateLimit;
    if (!rl || rl === true || this.opts.rateLimit === false) return false;
    const key = `${r.method} ${r.pattern}|${ip}`, now = Date.now();
    let h = this.hits.get(key);
    if (!h || h.reset <= now) { h = { n: 0, reset: now + windowMs(rl.timeWindow) }; this.hits.set(key, h); if (this.hits.size > 20000) for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k); }
    return ++h.n > rl.max;
  }

  async fetch(request: Request, meta: { ip?: string } = {}): Promise<Response> {
    const url = new URL(request.url);
    const headers: Record<string, string> = {}; request.headers.forEach((v, k) => { headers[k] = v; });
    const ip = (this.opts.trustProxy ? headers['cf-connecting-ip'] ?? headers['x-forwarded-for']?.split(',')[0].trim() : undefined) ?? meta.ip ?? '127.0.0.1';
    const q: Record<string, string | string[]> = {};
    url.searchParams.forEach((v, k) => { const o = q[k]; q[k] = o === undefined ? v : Array.isArray(o) ? [...o, v] : [o, v]; });
    const reply = new HttpReply();
    let bodyBuf: Buffer | null = null;
    const readBody = async () => (bodyBuf ??= Buffer.from(await request.arrayBuffer()));
    const req: HttpRequest = {
      method: request.method, url: url.pathname + url.search, params: {}, query: q, body: undefined, headers, cookies: parseCookies(request.headers.get('cookie')), ip, log: this.log,
      file: async (o) => {
        const ct = headers['content-type'] ?? '';
        if (!/^multipart\/form-data/i.test(ct)) return undefined;
        const form = await new Response(new Uint8Array(await readBody()), { headers: { 'content-type': ct } }).formData().catch(() => null);
        if (!form) return undefined;
        const limit = o?.limits?.fileSize ?? Infinity;
        let file: File | null = null; const fields: Record<string, any> = {};
        for (const [k, v] of form.entries()) {
          if (typeof v === 'string') fields[k] = { type: 'field', fieldname: k, value: v };
          else if (!file) { file = v; fields[k] = { type: 'file', fieldname: k, filename: v.name }; }
        }
        if (!file) return undefined;
        const f = file, truncated = f.size > limit;
        return { filename: f.name, mimetype: f.type || 'application/octet-stream', fields, file: { truncated }, toBuffer: async () => { if (truncated) throw new HttpError(413, 'Arquivo muito grande.'); return Buffer.from(await f.arrayBuffer()); } };
      },
    };
    try {
      let route: Route | undefined, pathOnly = url.pathname;
      for (const r of this.routes) {
        if (r.method !== request.method && !(request.method === 'HEAD' && r.method === 'GET')) continue;
        const m = r.re.exec(pathOnly); if (!m) continue;
        route = r; const p: Record<string, string> = {};
        r.keys.forEach((k, i) => { try { p[k] = decodeURIComponent(m[i + 1]); } catch { p[k] = m[i + 1]; } });
        req.params = p; break;
      }
      if (!route) { await this.run(this.notFound, req, reply); }
      else if (this.limited(route, ip)) { reply.code(429).send({ error: 'Muitas tentativas. Aguarde um pouco e tente de novo.' }); }
      else {
        const ct = headers['content-type'] ?? '';
        if (!['GET', 'HEAD', 'DELETE'].includes(request.method) || (request.method === 'DELETE' && request.headers.has('content-length'))) {
          if (/json/i.test(ct)) {
            const buf = await readBody();
            if (buf.length > (this.opts.bodyLimit ?? 1_048_576)) throw new HttpError(413, 'Corpo da requisição muito grande.');
            if (buf.length) { try { req.body = JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'JSON inválido.'); } }
          } else if (/x-www-form-urlencoded/i.test(ct)) {
            req.body = Object.fromEntries(new URLSearchParams((await readBody()).toString('utf8')));
          } else if (/^text\//i.test(ct)) req.body = (await readBody()).toString('utf8');
        }
        const hooks = ([] as Hook[]).concat(route.opts.preHandler ?? []);
        for (const h of hooks) { await h(req, reply); if (reply.sent) break; }
        if (!reply.sent) await this.run(route.handler, req, reply);
      }
    } catch (err: any) {
      reply.sent = false; reply.payload = undefined; reply.headers = new Headers(); reply.statusCode = 200;
      try { const v = await this.errorHandler(err, req, reply); if (!reply.sent && v !== undefined && v !== reply) reply.send(v); }
      catch { reply.code(500).send({ error: 'Erro interno.' }); }
    }
    for (const h of this.onSend) h(req, reply);
    const res = reply.toResponse();
    return request.method === 'HEAD' ? new Response(null, { status: res.status, headers: res.headers }) : res;
  }

  private async run(h: Handler, req: HttpRequest, reply: HttpReply) {
    const v = await h(req, reply);
    if (!reply.sent && v !== undefined && v !== reply) reply.send(v);
    else if (!reply.sent) reply.send(undefined);
  }

  /** Compatível com `fastify.inject` para os testes. */
  async inject(o: { method?: string; url: string; payload?: unknown; headers?: Record<string, string | undefined> }) {
    const headers = new Headers();
    for (const [k, v] of Object.entries(o.headers ?? {})) if (v !== undefined && v !== '') headers.set(k, v);
    let body: any; const p = o.payload;
    if (p !== undefined && p !== null) {
      if (p instanceof Uint8Array || typeof p === 'string') body = p;
      else { body = JSON.stringify(p); if (!headers.has('content-type')) headers.set('content-type', 'application/json'); }
    }
    const method = (o.method ?? 'GET').toUpperCase();
    const res = await this.fetch(new Request('http://localhost' + o.url, { method, headers, body: ['GET', 'HEAD'].includes(method) ? undefined : (typeof body === 'string' ? body : new Uint8Array(body)) }), { ip: '127.0.0.1' });
    const raw = Buffer.from(await res.arrayBuffer());
    const hs: Record<string, string | string[]> = {};
    res.headers.forEach((v, k) => { if (k !== 'set-cookie') hs[k] = v; });
    const sc = res.headers.getSetCookie(); if (sc.length) hs['set-cookie'] = sc;
    return { statusCode: res.status, headers: hs, body: raw.toString('utf8'), payload: raw.toString('utf8'), rawPayload: raw, json: () => JSON.parse(raw.toString('utf8')) };
  }
}

export type FastifyInstance = HttpApp;
export type FastifyRequest = HttpRequest;
export type FastifyReply = HttpReply;
export const createApp = (o: AppOptions = {}) => new HttpApp(o);
