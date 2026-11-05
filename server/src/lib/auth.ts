import crypto from 'node:crypto';
import argon2 from 'argon2';
import type { FastifyReply, FastifyRequest } from 'fastify';
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

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
export const newToken = () => crypto.randomBytes(32).toString('base64url');

export const hashPassword = (p: string) => argon2.hash(p, { type: argon2.argon2id });
export const verifyPassword = (hash: string, p: string) => argon2.verify(hash, p).catch(() => false);

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
