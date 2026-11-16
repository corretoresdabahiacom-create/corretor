import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from '../http/mini.js';
import { q, q1 } from '../db/pool.js';
import { config } from './config.js';
import { can, type Permission, type Role } from './permissions.js';

export const COOKIE = 'imobflow_sid';

export interface AuthUser {
  id: string;
  orgId: string;
  email: string;
  name: string;
  role: Role;
}

declare module '../http/mini.js' {
  interface HttpRequest {
    user?: AuthUser;
  }
}

export const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
export const newToken = () => crypto.randomBytes(32).toString('base64url');

// Senhas: PBKDF2-HMAC-SHA512 via WebCrypto (roda em Node e em Cloudflare Workers, que limita PBKDF2 a 100.000 iterações).
// Hashes antigos (argon2id) continuam válidos apenas quando rodando em Node; no Worker use `npm -w server run reset-password`.
const PBKDF2_ITER = Math.min(100_000, Number(process.env.PBKDF2_ITERATIONS ?? 100_000));
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
async function pbkdf2(pw: string, salt: Uint8Array<ArrayBuffer>, iter: number) {
  const key = await crypto.webcrypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.webcrypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-512', salt, iterations: iter }, key, 512));
}
export async function hashPassword(p: string) {
  const salt = new Uint8Array(crypto.randomBytes(16));
  return `pbkdf2$sha512$${PBKDF2_ITER}$${b64(salt)}$${b64(await pbkdf2(p, salt, PBKDF2_ITER))}`;
}
export async function verifyPassword(hash: string, p: string): Promise<boolean> {
  try {
    if (hash.startsWith('pbkdf2$')) {
      const [, , iter, salt, want] = hash.split('$');
      const got = Buffer.from(await pbkdf2(p, new Uint8Array(Buffer.from(salt, 'base64')), Number(iter)));
      const w = Buffer.from(want, 'base64');
      return got.length === w.length && crypto.timingSafeEqual(got, w);
    }
    if (hash.startsWith('$argon2')) { const argon2 = (await import('argon2')).default; return await argon2.verify(hash, p); }
  } catch { /* hash legado indisponível neste ambiente */ }
  return false;
}

export function passwordProblem(p: string): string | null {
  if (p.length < 10) return 'A senha precisa ter pelo menos 10 caracteres.';
  if (!/[a-zA-Z]/.test(p) || !/\d/.test(p)) return 'Use letras e números na senha.';
  return null;
}

export async function createSession(userId: string, reply: FastifyReply) {
  const token = newToken();
  const expires = new Date(Date.now() + config.sessionDays * 86400_000);
  await q('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES ($1,$2,$3)', [hashToken(token), userId, expires]);
  reply.setCookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    expires,
  });
}

export async function loadUser(req: FastifyRequest): Promise<AuthUser | null> {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  const row = await q1(
    `SELECT u.id, u.org_id, u.email, u.name, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`,
    [hashToken(token)],
  );
  return row ? { id: row.id, orgId: row.org_id, email: row.email, name: row.name, role: row.role } : null;
}

/** Exige login. Em mutações, também exige JSON e Origin confiável (proteção CSRF além do SameSite). */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.headers.origin;
    const devOrigin = !config.isProd && (origin?.startsWith('http://127.0.0.1') || origin?.startsWith('http://localhost'));
    if (origin && origin !== config.publicOrigin && !devOrigin) {
      return reply.code(403).send({ error: 'Origem não permitida.' });
    }
  }
  const user = await loadUser(req);
  if (!user) return reply.code(401).send({ error: 'Sessão expirada. Entre novamente.' });
  req.user = user;
}

export function requirePerm(perm: Permission) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(req, reply);
    if (reply.sent) return;
    if (!can(req.user!.role, perm)) {
      return reply.code(403).send({ error: 'Você não tem permissão para esta ação.' });
    }
  };
}

export async function audit(
  req: FastifyRequest,
  action: string,
  entity?: string,
  entityId?: string,
  detail: Record<string, unknown> = {},
) {
  await q('INSERT INTO audit_log(org_id,user_id,action,entity,entity_id,detail,ip) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
    req.user?.orgId ?? null,
    req.user?.id ?? null,
    action,
    entity ?? null,
    entityId ?? null,
    JSON.stringify(detail),
    req.ip,
  ]);
}
