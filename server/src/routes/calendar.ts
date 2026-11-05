import type { FastifyInstance } from 'fastify';
import { q, q1 } from '../db/pool.js';
import { audit, hashToken, newToken, requirePerm } from '../lib/auth.js';
import { can } from '../lib/permissions.js';
import { config } from '../lib/config.js';

const rl = (max: number, timeWindow: string) => ({ config: { rateLimit: process.env.RATE_LIMIT_DISABLED === 'true' ? false : { max, timeWindow } } });
const esc = (s: unknown) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
// Dobra linhas com mais de 75 bytes (RFC 5545).
const fold = (l: string) => { const out: string[] = []; let b = Buffer.from(l); while (b.length > 74) { let n = 74; while ((b[n] & 0xc0) === 0x80) n--; out.push(b.subarray(0, n).toString()); b = Buffer.concat([Buffer.from(' '), b.subarray(n)]); } out.push(b.toString()); return out.join('\r\n'); };

export async function calendarRoutes(app: FastifyInstance) {
  // Gera (ou troca) o link pessoal de assinatura. O token só é mostrado uma vez; no banco fica apenas o hash.
  app.post('/api/calendar/token', { preHandler: requirePerm('events.read') }, async (req) => {
    const token = newToken();
    await q('UPDATE users SET calendar_token_hash=$2 WHERE id=$1', [req.user!.id, hashToken(token)]);
    await audit(req, 'calendar.token.create', 'user', req.user!.id);
    return { url: `${config.publicOrigin.replace(/\/$/, '')}/api/calendar/feed.ics?token=${token}` };
  });
  app.delete('/api/calendar/token', { preHandler: requirePerm('events.read') }, async (req) => {
    await q('UPDATE users SET calendar_token_hash=NULL WHERE id=$1', [req.user!.id]);
    return { ok: true };
  });

  // Feed iCalendar (somente leitura) para Google Agenda, Apple, Outlook: "adicionar agenda por URL".
  app.get('/api/calendar/feed.ics', rl(60, '1 hour'), async (req, reply) => {
    const token = String((req.query as any).token ?? '');
    const u = token.length >= 20 ? await q1<any>('SELECT id,org_id,role FROM users WHERE calendar_token_hash=$1 AND active', [hashToken(token)]) : null;
    if (!u) return reply.code(404).send({ error: 'Link inválido.' });
    const all = can(u.role, 'events.all');
    const rows = await q<any>(
      `SELECT e.*, p.code AS property_code, pe.name AS person_name FROM events e LEFT JOIN properties p ON p.id=e.property_id LEFT JOIN people pe ON pe.id=e.person_id
        WHERE e.org_id=$1 AND e.status IN ('agendado','concluido') AND e.starts_at > now() - interval '30 days' AND e.starts_at < now() + interval '180 days'
          AND ($3 OR e.owner_user_id=$2 OR $2 = ANY(e.participants)) ORDER BY e.starts_at`, [u.org_id, u.id, all]);
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ImobFlow//Agenda//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:ImobFlow', 'X-PUBLISHED-TTL:PT1H'];
    for (const e of rows) {
      const desc = [e.person_name && `Pessoa: ${e.person_name}`, e.property_code && `Imóvel: ${e.property_code}`, e.instructions].filter(Boolean).join('\n');
      lines.push('BEGIN:VEVENT', `UID:${e.id}@imobflow`, `DTSTAMP:${utc(new Date(e.updated_at ?? e.created_at ?? Date.now()))}`, `DTSTART:${utc(new Date(e.starts_at))}`, `DTEND:${utc(new Date(e.ends_at))}`,
        `SUMMARY:${esc(e.title)}`, ...(e.location ? [`LOCATION:${esc(e.location)}`] : []), ...(desc ? [`DESCRIPTION:${esc(desc)}`] : []), `STATUS:${e.status === 'concluido' ? 'CONFIRMED' : 'CONFIRMED'}`, 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return reply.header('content-type', 'text/calendar; charset=utf-8').header('cache-control', 'private, max-age=300').send(lines.map(fold).join('\r\n') + '\r\n');
  });
}
