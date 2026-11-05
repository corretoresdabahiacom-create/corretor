import { q1 } from '../db/pool.js';

// Limites do plano gratuito. Plano pago ainda não existe (sem cobrança implementada).
export const PLAN_LIMITS: Record<string, { properties: number; users: number; published: number }> = {
  gratuito: { properties: 15, users: 3, published: 5 },
  ilimitado: { properties: 1e9, users: 1e9, published: 1e9 }, // uso interno/testes
};

export async function usage(orgId: string) {
  const r = await q1<any>(
    `SELECT o.plan,
       (SELECT count(*)::int FROM properties WHERE org_id=o.id AND status<>'arquivado') AS properties,
       (SELECT count(*)::int FROM users WHERE org_id=o.id AND active) +
       (SELECT count(*)::int FROM invites WHERE org_id=o.id AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now()) AS users,
       (SELECT count(*)::int FROM properties WHERE org_id=o.id AND published_at IS NOT NULL) AS published
     FROM organizations o WHERE o.id=$1`, [orgId]);
  const limits = PLAN_LIMITS[r.plan] ?? PLAN_LIMITS.gratuito;
  return { plan: r.plan, limits, used: { properties: r.properties, users: r.users, published: r.published } };
}

const NAMES = { properties: 'imóveis', users: 'usuários (incluindo convites pendentes)', published: 'imóveis publicados' } as const;
/** Devolve mensagem de bloqueio se o plano não comporta mais um item; null se pode seguir. */
export async function limitProblem(orgId: string, what: keyof typeof NAMES): Promise<string | null> {
  const u = await usage(orgId);
  if (u.used[what] >= u.limits[what]) return `O plano ${u.plan} permite até ${u.limits[what]} ${NAMES[what]}. Arquive ou remova algum para continuar.`;
  return null;
}
