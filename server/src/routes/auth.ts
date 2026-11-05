import type { FastifyInstance } from 'fastify';
import { sendMail } from '../lib/mailer.js';
import { limitProblem } from '../lib/plans.js';
import { z } from 'zod';
import { effectiveTheme } from '../lib/appTheme.js';
import { q, q1, tx } from '../db/pool.js';
import {
  audit, COOKIE, createSession, hashPassword, hashToken, newToken, passwordProblem,
  requireAuth, requirePerm, verifyPassword,
} from '../lib/auth.js';
import { config } from '../lib/config.js';
import { ROLE_PERMISSIONS } from '../lib/permissions.js';

export const DEFAULT_STAGES = [
  ['novo_contato', 'Novo contato', 'aberta'],
  ['qualificacao', 'Qualificação', 'aberta'],
  ['imoveis_apresentados', 'Imóveis apresentados', 'aberta'],
  ['visita_agendada', 'Visita agendada', 'aberta'],
  ['visita_realizada', 'Visita realizada', 'aberta'],
  ['proposta', 'Proposta', 'aberta'],
  ['negociacao', 'Negociação', 'aberta'],
  ['fechado', 'Fechado', 'ganha'],
  ['perdido', 'Perdido', 'perdida'],
] as const;

// Limite de requisições por rota (desligável apenas nos testes automatizados)
const rl = (max: number, timeWindow: string) => ({ config: { rateLimit: process.env.RATE_LIMIT_DISABLED === 'true' ? false : { max, timeWindow } } });

const slugify = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const emailSchema = z.string().trim().toLowerCase().email('Informe um e-mail válido.');
const passSchema = z.string().superRefine((p, ctx) => {
  const m = passwordProblem(p);
  if (m) ctx.addIssue({ code: 'custom', message: m });
});

export async function authRoutes(app: FastifyInstance) {
  // Criar imobiliária + administrador
  app.post('/api/auth/register', rl(10, '1 hour'), async (req, reply) => {
    const body = z
      .object({ orgName: z.string().trim().min(2, 'Informe o nome da imobiliária.'), name: z.string().trim().min(2), email: emailSchema, password: passSchema, ref: z.string().max(80).optional() })
      .parse(req.body);
    if (await q1('SELECT 1 FROM users WHERE email=$1', [body.email])) {
      return reply.code(409).send({ error: 'Este e-mail já está cadastrado.' });
    }
    const result = await tx(async (c) => {
      let slug = slugify(body.orgName) || 'imobiliaria';
      const exists = await c.query('SELECT 1 FROM organizations WHERE slug=$1', [slug]);
      if (exists.rowCount) slug += '-' + Math.random().toString(36).slice(2, 6);
      const org = (await c.query('INSERT INTO organizations(name,slug,referred_by_org) VALUES ($1,$2,(SELECT id FROM organizations WHERE slug=$3)) RETURNING id', [body.orgName, slug, body.ref ?? null])).rows[0];
      const user = (
        await c.query('INSERT INTO users(org_id,email,name,password_hash,role) VALUES ($1,$2,$3,$4,$5) RETURNING id', [
          org.id, body.email, body.name, await hashPassword(body.password), 'admin',
        ])
      ).rows[0];
      for (let i = 0; i < DEFAULT_STAGES.length; i++) {
        const [key, label, kind] = DEFAULT_STAGES[i];
        await c.query('INSERT INTO pipeline_stages(org_id,key,label,position,kind) VALUES ($1,$2,$3,$4,$5)', [org.id, key, label, i, kind]);
      }
      return { orgId: org.id, userId: user.id };
    });
    await createSession(result.userId, reply);
    req.user = { id: result.userId, orgId: result.orgId, email: body.email, name: body.name, role: 'admin' };
    await audit(req, 'org.create', 'organization', result.orgId);
    return reply.code(201).send({ ok: true });
  });

  app.post('/api/auth/login', rl(10, '15 minutes'), async (req, reply) => {
    const body = z.object({ email: emailSchema, password: z.string().min(1) }).parse(req.body);
    const u = await q1('SELECT id, org_id, password_hash, active FROM users WHERE email=$1', [body.email]);
    // mensagem genérica: não revela se o e-mail existe
    if (!u || !u.active || !(await verifyPassword(u.password_hash, body.password))) {
      return reply.code(401).send({ error: 'E-mail ou senha incorretos.' });
    }
    await createSession(u.id, reply);
    req.user = { id: u.id, orgId: u.org_id, email: body.email, name: '', role: 'consulta' };
    await audit(req, 'auth.login', 'user', u.id);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const t = req.cookies?.[COOKIE];
    if (t) await q('DELETE FROM sessions WHERE token_hash=$1', [hashToken(t)]);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (req) => {
    const o = await q1<any>('SELECT id,name,slug,plan,settings,app_theme,site,brand FROM organizations WHERE id=$1', [req.user!.orgId]);
    const { app_theme, site, brand, ...org } = o;
    return { user: req.user, org, permissions: ROLE_PERMISSIONS[req.user!.role], appName: config.appName, theme: effectiveTheme(o) };
  });

  // Recuperação de senha. Sem serviço de e-mail integrado, o link só é devolvido em modo desenvolvimento.
  app.post('/api/auth/forgot', rl(5, '15 minutes'), async (req) => {
    const { email } = z.object({ email: emailSchema }).parse(req.body);
    const u = await q1('SELECT id FROM users WHERE email=$1 AND active', [email]);
    const out: Record<string, unknown> = { ok: true, message: 'Se o e-mail existir, enviaremos as instruções.' };
    if (u) {
      const token = newToken();
      await q('INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval \'1 hour\')', [hashToken(token), u.id]);
      await sendMail({ to: email, subject: 'Redefinir sua senha', text: `Use este link em até 1 hora para criar uma nova senha:\n${config.publicOrigin}/redefinir/${token}\n\nSe não foi você, ignore este e-mail.` });
      if (config.devExposeTokens) out.devToken = token; // MODO DESENVOLVIMENTO
    }
    return out;
  });

  app.post('/api/auth/reset', async (req, reply) => {
    const body = z.object({ token: z.string().min(10), password: passSchema }).parse(req.body);
    const r = await q1('SELECT user_id FROM password_resets WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now()', [hashToken(body.token)]);
    if (!r) return reply.code(400).send({ error: 'Link inválido ou expirado.' });
    await tx(async (c) => {
      await c.query('UPDATE users SET password_hash=$1, updated_at=now() WHERE id=$2', [await hashPassword(body.password), r.user_id]);
      await c.query('UPDATE password_resets SET used_at=now() WHERE token_hash=$1', [hashToken(body.token)]);
      await c.query('DELETE FROM sessions WHERE user_id=$1', [r.user_id]); // encerra sessões antigas
    });
    return { ok: true };
  });

  // ---- Usuários e convites ----
  app.get('/api/users', { preHandler: requireAuth }, async (req) => {
    return q('SELECT id,name,email,role,active,created_at FROM users WHERE org_id=$1 ORDER BY name', [req.user!.orgId]);
  });

  app.patch('/api/users/:id', { preHandler: requirePerm('users.manage') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ role: z.enum(['gestor', 'corretor', 'assistente', 'consulta']).optional(), active: z.boolean().optional() }).parse(req.body);
    const target = await q1('SELECT id, role FROM users WHERE id=$1 AND org_id=$2', [id, req.user!.orgId]);
    if (!target) return reply.code(404).send({ error: 'Usuário não encontrado.' });
    if (target.role === 'admin') return reply.code(400).send({ error: 'O administrador não pode ser alterado aqui.' });
    await q('UPDATE users SET role=coalesce($1,role), active=coalesce($2,active), updated_at=now() WHERE id=$3', [body.role ?? null, body.active ?? null, id]);
    if (body.active === false) await q('DELETE FROM sessions WHERE user_id=$1', [id]);
    await audit(req, 'user.update', 'user', id, body);
    return { ok: true };
  });

  app.post('/api/invites', { preHandler: requirePerm('users.manage') }, async (req, reply) => {
    const body = z
      .object({ email: emailSchema, role: z.enum(['gestor', 'corretor', 'assistente', 'consulta']), days: z.number().int().min(1).max(30).default(7) })
      .parse(req.body);
    if (await q1('SELECT 1 FROM users WHERE email=$1', [body.email])) return reply.code(409).send({ error: 'Este e-mail já tem conta.' });
    const lim = await limitProblem(req.user!.orgId, 'users');
    if (lim) return reply.code(402).send({ error: lim, code: 'PLAN_LIMIT' });
    const token = newToken();
    const inv = await q1(
      `INSERT INTO invites(org_id,email,role,token_hash,expires_at,created_by) VALUES ($1,$2,$3,$4, now() + ($5 || ' days')::interval, $6) RETURNING id, expires_at`,
      [req.user!.orgId, body.email, body.role, hashToken(token), String(body.days), req.user!.id],
    );
    await audit(req, 'invite.create', 'invite', inv.id, { role: body.role });
    const link = `${config.publicOrigin}/convite/${token}`;
    const org = await q1<any>('SELECT name FROM organizations WHERE id=$1', [req.user!.orgId]);
    const emailed = await sendMail({ to: body.email, subject: `Convite para ${org?.name ?? 'a equipe'}`, text: `Você foi convidado(a) para ${org?.name ?? 'uma imobiliária'} como ${body.role}.\nAceite em até ${body.days} dia(s):\n${link}` });
    // O link continua visível para o administrador (útil se o e-mail estiver desligado ou cair no spam).
    return reply.code(201).send({ id: inv.id, expires_at: inv.expires_at, link, emailed });
  });

  app.get('/api/invites', { preHandler: requirePerm('users.manage') }, async (req) =>
    q(`SELECT id,email,role,expires_at,accepted_at,revoked_at,created_at FROM invites WHERE org_id=$1 ORDER BY created_at DESC`, [req.user!.orgId]),
  );

  app.delete('/api/invites/:id', { preHandler: requirePerm('users.manage') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await q('UPDATE invites SET revoked_at=now() WHERE id=$1 AND org_id=$2 AND accepted_at IS NULL RETURNING id', [id, req.user!.orgId]);
    if (!r.length) return reply.code(404).send({ error: 'Convite não encontrado.' });
    await audit(req, 'invite.revoke', 'invite', id);
    return { ok: true };
  });

  app.get('/api/invites/preview/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const inv = await q1(
      `SELECT i.email, i.role, o.name AS org_name FROM invites i JOIN organizations o ON o.id=i.org_id
        WHERE i.token_hash=$1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now()`,
      [hashToken(token)],
    );
    if (!inv) return reply.code(404).send({ error: 'Convite inválido, expirado ou revogado.' });
    return inv;
  });

  app.post('/api/invites/accept', rl(10, '1 hour'), async (req, reply) => {
    const body = z.object({ token: z.string().min(10), name: z.string().trim().min(2), password: passSchema }).parse(req.body);
    const inv = await q1(
      `SELECT id, org_id, email, role FROM invites WHERE token_hash=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now()`,
      [hashToken(body.token)],
    );
    if (!inv) return reply.code(400).send({ error: 'Convite inválido, expirado ou revogado.' });
    if (await q1('SELECT 1 FROM users WHERE email=$1', [inv.email])) return reply.code(409).send({ error: 'Este e-mail já tem conta.' });
    const user = await tx(async (c) => {
      const u = (
        await c.query('INSERT INTO users(org_id,email,name,password_hash,role) VALUES ($1,$2,$3,$4,$5) RETURNING id', [
          inv.org_id, inv.email, body.name, await hashPassword(body.password), inv.role,
        ])
      ).rows[0];
      await c.query('UPDATE invites SET accepted_at=now() WHERE id=$1', [inv.id]);
      return u;
    });
    await createSession(user.id, reply);
    return reply.code(201).send({ ok: true });
  });
}
