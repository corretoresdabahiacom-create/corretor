// Calendário de temporada: reservas/bloqueios por imóvel, sem sobreposição, disponibilidade pública e feed iCal.
import type { FastifyInstance } from '../http/mini.js';
import { z } from 'zod';
import { q, q1, tx } from '../db/pool.js';
import { audit, newToken, requirePerm } from '../lib/auth.js';

const rl = (max: number, timeWindow: string) => ({ config: { rateLimit: process.env.RATE_LIMIT_DISABLED === 'true' ? false : { max, timeWindow } } });
const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.').refine((s) => new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s, 'Data inválida.');
const asStr = (d: any) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : String(d ?? '').slice(0, 10));
const icsEsc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const compact = (s: string) => s.replace(/-/g, '');

const stay = z.object({
  guest_person_id: uuid.nullish(), guest_name: z.string().trim().max(120).nullish(), guests: z.number().int().min(1).max(100).nullish(),
  start_date: date, end_date: date, status: z.enum(['reserva', 'confirmada', 'cancelada', 'bloqueio']).default('confirmada'),
  source: z.string().trim().max(40).default('direto'), total_amount: z.number().min(0).max(1e9).nullish(), deposit_amount: z.number().min(0).max(1e9).nullish(), notes: z.string().max(1000).nullish(),
});

export async function stayRoutes(app: FastifyInstance) {
  const read = requirePerm('properties.read'), write = requirePerm('properties.write');
  const prop = (org: string, id: string) => q1<any>('SELECT id,title,public_code,ical_token FROM properties WHERE id=$1 AND org_id=$2', [id, org]);

  app.get('/api/properties/:id/stays', { preHandler: read }, async (req, reply) => {
    const id = uuid.parse((req.params as any).id); const org = req.user!.orgId;
    if (!(await prop(org, id))) return reply.code(404).send({ error: 'Imóvel não encontrado.' });
    const from = (req.query as any).from ? date.parse((req.query as any).from) : null;
    return q(`SELECT s.*, COALESCE(p.display_name,p.name) AS guest_person_name FROM property_stays s LEFT JOIN people p ON p.id=s.guest_person_id WHERE s.org_id=$1 AND s.property_id=$2 AND ($3::date IS NULL OR s.end_date >= $3) ORDER BY s.start_date`, [org, id, from]);
  });

  /** Grava sob trava por imóvel: reservas ativas (não canceladas) não podem se sobrepor; check-out libera a noite. */
  async function save(org: string, propertyId: string, stayId: string | null, b: z.infer<typeof stay>, userId: string) {
    return tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['stay:' + propertyId]);
      if (b.status !== 'cancelada') {
        const r = await c.query(`SELECT 1 FROM property_stays WHERE property_id=$1 AND status<>'cancelada' AND ($4::uuid IS NULL OR id<>$4) AND start_date < $3 AND end_date > $2 LIMIT 1`, [propertyId, b.start_date, b.end_date, stayId]);
        if (r.rowCount) return { conflict: true as const };
      }
      if (b.guest_person_id) { const ok = await c.query('SELECT 1 FROM people WHERE id=$1 AND org_id=$2', [b.guest_person_id, org]); if (!ok.rowCount) return { badPerson: true as const }; }
      const vals = [b.guest_person_id ?? null, b.guest_name ?? null, b.guests ?? null, b.start_date, b.end_date, b.status, b.source, b.total_amount ?? null, b.deposit_amount ?? null, b.notes ?? null];
      const r = stayId
        ? await c.query(`UPDATE property_stays SET guest_person_id=$3,guest_name=$4,guests=$5,start_date=$6,end_date=$7,status=$8,source=$9,total_amount=$10,deposit_amount=$11,notes=$12,updated_at=now() WHERE id=$1 AND org_id=$2 RETURNING *`, [stayId, org, ...vals])
        : await c.query(`INSERT INTO property_stays(org_id,property_id,guest_person_id,guest_name,guests,start_date,end_date,status,source,total_amount,deposit_amount,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [org, propertyId, ...vals, userId]);
      return { row: r.rows[0] };
    });
  }
  const fail = (reply: any, r: any) => (r.conflict ? reply.code(409).send({ error: 'Essas datas já estão ocupadas por outra reserva ou bloqueio.' }) : reply.code(400).send({ error: 'Hóspede não encontrado.' }));

  app.post('/api/properties/:id/stays', { preHandler: write }, async (req, reply) => {
    const id = uuid.parse((req.params as any).id); const b = stay.parse(req.body); const org = req.user!.orgId;
    if (b.end_date <= b.start_date) return reply.code(400).send({ error: 'O check-out deve ser depois do check-in.' });
    if (!(await prop(org, id))) return reply.code(404).send({ error: 'Imóvel não encontrado.' });
    const r = await save(org, id, null, b, req.user!.id);
    if (!('row' in r)) return fail(reply, r);
    await audit(req, 'stay.create', 'property', id, { status: b.status });
    return reply.code(201).send(r.row);
  });
  app.patch('/api/stays/:id', { preHandler: write }, async (req, reply) => {
    const id = uuid.parse((req.params as any).id); const org = req.user!.orgId;
    const cur = await q1<any>('SELECT * FROM property_stays WHERE id=$1 AND org_id=$2', [id, org]);
    if (!cur) return reply.code(404).send({ error: 'Reserva não encontrada.' });
    const b = stay.parse({ ...cur, start_date: asStr(cur.start_date), end_date: asStr(cur.end_date), ...(req.body as object) });
    if (b.end_date <= b.start_date) return reply.code(400).send({ error: 'O check-out deve ser depois do check-in.' });
    const r = await save(org, cur.property_id, id, b, req.user!.id);
    if (!('row' in r)) return fail(reply, r);
    await audit(req, 'stay.update', 'property', cur.property_id, { status: b.status });
    return r.row;
  });
  app.delete('/api/stays/:id', { preHandler: write }, async (req, reply) => {
    const r = await q('DELETE FROM property_stays WHERE id=$1 AND org_id=$2 RETURNING property_id', [uuid.parse((req.params as any).id), req.user!.orgId]);
    if (!r.length) return reply.code(404).send({ error: 'Reserva não encontrada.' });
    await audit(req, 'stay.delete', 'property', (r[0] as any).property_id);
    return { ok: true };
  });

  // Link iCal para Airbnb/Booking/Google Agenda importarem a ocupação (token secreto, pode ser regenerado).
  app.post('/api/properties/:id/ical-token', { preHandler: write }, async (req, reply) => {
    const id = uuid.parse((req.params as any).id); const org = req.user!.orgId;
    if (!(await prop(org, id))) return reply.code(404).send({ error: 'Imóvel não encontrado.' });
    const t = newToken();
    await q('UPDATE properties SET ical_token=$3 WHERE id=$1 AND org_id=$2', [id, org, t]);
    await audit(req, 'stay.ical_token', 'property', id);
    return { token: t, path: `/ical/${t}.ics` };
  });
  app.delete('/api/properties/:id/ical-token', { preHandler: write }, async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    await q('UPDATE properties SET ical_token=NULL WHERE id=$1 AND org_id=$2', [id, req.user!.orgId]);
    return { ok: true };
  });

  app.get('/ical/:file', rl(60, '1 minute'), async (req, reply) => {
    const m = /^([A-Za-z0-9_-]{20,80})\.ics$/.exec(String((req.params as any).file));
    const p = m ? await q1<any>('SELECT id,title FROM properties WHERE ical_token=$1', [m[1]]) : null;
    if (!p) return reply.code(404).type('text/plain').send('Não encontrado');
    const rows = await q<any>(`SELECT id,start_date,end_date,status,updated_at FROM property_stays WHERE property_id=$1 AND status<>'cancelada' AND end_date >= (now() - interval '30 days')::date ORDER BY start_date`, [p.id]);
    const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    // Sem nome de hóspede nem valores: o feed só diz que o período está ocupado.
    const ev = rows.map((r) => ['BEGIN:VEVENT', `UID:${r.id}@imobflow`, `DTSTAMP:${stamp(new Date(r.updated_at))}`, `DTSTART;VALUE=DATE:${compact(asStr(r.start_date))}`, `DTEND;VALUE=DATE:${compact(asStr(r.end_date))}`, `SUMMARY:${r.status === 'bloqueio' ? 'Bloqueado' : 'Ocupado'}`, 'END:VEVENT'].join('\r\n'));
    const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ImobFlow//Temporada//PT', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsEsc(p.title)}`, ...ev, 'END:VCALENDAR'].join('\r\n') + '\r\n';
    return reply.header('cache-control', 'private, max-age=300').header('x-robots-tag', 'noindex').type('text/calendar; charset=utf-8').send(body);
  });

  // Disponibilidade pública (só datas ocupadas, sem dados de hóspede) para o imóvel de temporada publicado.
  app.get('/api/public/p/:code/availability', rl(60, '1 minute'), async (req, reply) => {
    const code = String((req.params as any).code);
    const p = /^[a-z0-9]{6,12}$/.test(code) ? await q1<any>(`SELECT id FROM properties WHERE public_code=$1 AND published_at IS NOT NULL AND status<>'arquivado' AND 'temporada' = ANY(purposes)`, [code]) : null;
    if (!p) return reply.code(404).send({ error: 'Anúncio não encontrado.' });
    const rows = await q<any>(`SELECT start_date,end_date FROM property_stays WHERE property_id=$1 AND status IN ('confirmada','reserva','bloqueio') AND end_date > now()::date AND start_date < (now() + interval '540 days')::date ORDER BY start_date`, [p.id]);
    return reply.header('cache-control', 'public, max-age=60').send({ busy: rows.map((r) => ({ from: asStr(r.start_date), to: asStr(r.end_date) })) });
  });
}
