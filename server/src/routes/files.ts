import sharp from 'sharp';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import { z } from 'zod';
import { q, q1, tx } from '../db/pool.js';
import { audit, requireAuth, requirePerm } from '../lib/auth.js';
import { can, type Permission } from '../lib/permissions.js';
import { config } from '../lib/config.js';
import { storage, sniffMime } from '../lib/storage.js';

const MAX_PHOTOS = 40;
const DOC_TYPES = ['matricula', 'ccir', 'itr', 'car', 'escritura', 'iptu', 'contrato', 'procuracao', 'laudo', 'identidade', 'comprovante', 'outro'];
type Owner = { column: 'property_id' | 'person_id' | 'contract_id'; id: string };

/** Permissão necessária para LER um arquivo, conforme a quem ele pertence e a categoria. */
function readPerm(f: { category: string; property_id: string | null; person_id: string | null }): Permission {
  if (f.person_id) return 'people.document';
  if (f.property_id) return f.category === 'foto' ? 'properties.read' : 'properties.internal';
  return 'contracts.read';
}
function writePerm(owner: Owner, category: string): Permission[] {
  if (owner.column === 'person_id') return ['people.document', 'people.write'];
  if (owner.column === 'contract_id') return ['contracts.write'];
  return category === 'foto' ? ['properties.write'] : ['properties.write', 'properties.internal'];
}

async function ownerExists(orgId: string, o: Owner) {
  const table = { property_id: 'properties', person_id: 'people', contract_id: 'contracts' }[o.column];
  return !!(await q1(`SELECT 1 FROM ${table} WHERE id=$1 AND org_id=$2`, [o.id, orgId]));
}

const pub = (f: any) => ({
  id: f.id, category: f.category, doc_type: f.doc_type, visibility: f.visibility, filename: f.filename, mime: f.mime,
  size_bytes: f.size_bytes, caption: f.caption, position: f.position, is_cover: f.is_cover, created_at: f.created_at,
  url: `/api/files/${f.id}/download`,
});

export async function fileRoutes(app: FastifyInstance) {
  async function upload(req: FastifyRequest, reply: any, owner: Owner) {
    const user = req.user!;
    if (!(await ownerExists(user.orgId, owner))) return reply.code(404).send({ error: 'Registro não encontrado.' });
    const part = await req.file();
    if (!part) return reply.code(400).send({ error: 'Envie um arquivo.' });
    const fields = Object.fromEntries(Object.entries(part.fields).filter(([, v]: any) => v && 'value' in v).map(([k, v]: any) => [k, v.value]));
    const meta = z
      .object({
        category: z.enum(['foto', 'documento']).default(owner.column === 'property_id' ? 'foto' : 'documento'),
        doc_type: z.enum(DOC_TYPES as [string, ...string[]]).optional(),
        visibility: z.enum(['privado', 'publico']).default('privado'),
        caption: z.string().max(200).optional(),
      })
      .parse(fields);
    if (meta.category === 'foto' && owner.column !== 'property_id') return reply.code(400).send({ error: 'Fotos só podem ser anexadas a imóveis.' });
    if (!writePerm(owner, meta.category).every((p) => can(user.role, p))) return reply.code(403).send({ error: 'Você não tem permissão para esta ação.' });
    if (meta.category === 'documento') meta.visibility = 'privado'; // documentos nunca são públicos

    let buf: Buffer;
    try { buf = await part.toBuffer(); } catch { return reply.code(413).send({ error: `Arquivo maior que ${config.maxUploadBytes / 1024 / 1024} MB.` }); }
    if (part.file.truncated) return reply.code(413).send({ error: `Arquivo maior que ${config.maxUploadBytes / 1024 / 1024} MB.` });
    const mime = sniffMime(buf);
    if (!mime || (meta.category === 'foto' && mime === 'application/pdf')) {
      return reply.code(415).send({ error: meta.category === 'foto' ? 'Foto deve ser JPG, PNG ou WebP.' : 'Documento deve ser PDF, JPG, PNG ou WebP.' });
    }
    if (meta.category === 'foto') {
      const n = await q1<{ n: number }>(`SELECT count(*)::int n FROM files WHERE org_id=$1 AND property_id=$2 AND category='foto'`, [user.orgId, owner.id]);
      if ((n?.n ?? 0) >= MAX_PHOTOS) return reply.code(409).send({ error: `Limite de ${MAX_PHOTOS} fotos por imóvel.` });
    }
    const id = crypto.randomUUID();
    const key = `${user.orgId}/${id}`;
    await storage().put(key, buf, mime);
    const filename = (part.filename || 'arquivo').replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120);
    try {
      const row = await tx(async (c) => {
        let cover = false;
        if (meta.category === 'foto') {
          cover = !(await c.query(`SELECT 1 FROM files WHERE org_id=$1 AND property_id=$2 AND category='foto' AND is_cover`, [user.orgId, owner.id])).rowCount;
        }
        const pos = (await c.query(`SELECT COALESCE(max(position),-1)+1 AS p FROM files WHERE org_id=$1 AND ${owner.column}=$2`, [user.orgId, owner.id])).rows[0].p;
        return (await c.query(
          `INSERT INTO files(id,org_id,${owner.column},category,doc_type,visibility,filename,mime,size_bytes,sha256,storage_key,caption,position,is_cover,uploaded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
          [id, user.orgId, owner.id, meta.category, meta.doc_type ?? null, meta.visibility, filename, mime, buf.length, crypto.createHash('sha256').update(buf).digest('hex'), key, meta.caption ?? null, pos, cover, user.id],
        )).rows[0];
      });
      await audit(req, 'file.upload', 'file', id, { category: meta.category, owner: owner.column });
      return reply.code(201).send(pub(row));
    } catch (e) { await storage().del(key).catch(() => {}); throw e; }
  }

  const mk = (col: Owner['column'], base: string, perm: Permission) => {
    app.post(`${base}/:id/files`, { preHandler: requirePerm(perm) }, async (req, reply) => upload(req, reply, { column: col, id: z.string().uuid().parse((req.params as any).id) }));
    app.get(`${base}/:id/files`, { preHandler: requirePerm(perm) }, async (req, reply) => {
      const id = z.string().uuid().parse((req.params as any).id);
      if (!(await ownerExists(req.user!.orgId, { column: col, id }))) return reply.code(404).send({ error: 'Registro não encontrado.' });
      const canDocs = col !== 'property_id' || can(req.user!.role, 'properties.internal');
      const rows = await q(`SELECT * FROM files WHERE org_id=$1 AND ${col}=$2 ${canDocs ? '' : `AND category='foto'`} ORDER BY category, position, created_at`, [req.user!.orgId, id]);
      return rows.map(pub);
    });
  };
  mk('property_id', '/api/properties', 'properties.read');
  mk('person_id', '/api/people', 'people.document');
  mk('contract_id', '/api/contracts', 'contracts.read');

  async function loadFile(req: FastifyRequest, reply: any) {
    const id = z.string().uuid().safeParse((req.params as any).id);
    const f = id.success ? await q1<any>('SELECT * FROM files WHERE id=$1 AND org_id=$2', [id.data, req.user!.orgId]) : null;
    if (!f) { reply.code(404).send({ error: 'Arquivo não encontrado.' }); return null; }
    if (!can(req.user!.role, readPerm(f))) { reply.code(403).send({ error: 'Você não tem permissão para esta ação.' }); return null; }
    return f;
  }

  app.get('/api/files/:id/download', { preHandler: requireAuth }, async (req, reply) => {
    const f = await loadFile(req, reply); if (!f) return;
    const data = await storage().get(f.storage_key);
    await audit(req, 'file.download', 'file', f.id);
    return reply
      .header('content-type', f.mime)
      .header('content-disposition', `${f.category === 'foto' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.filename)}`)
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .send(data);
  });

  // Miniatura de foto para listas do app (mesma permissão do download; sem registro de auditoria a cada exibição).
  const thumbs = new Map<string, Buffer>();
  app.get('/api/files/:id/thumb', { preHandler: requireAuth }, async (req, reply) => {
    const f = await loadFile(req, reply); if (!f) return;
    if (f.category !== 'foto') return reply.code(400).send({ error: 'Só fotos têm miniatura.' });
    const w = [320, 480, 800].includes(Number((req.query as any).w)) ? Number((req.query as any).w) : 480;
    const ck = `${f.id}:${w}`; let out = thumbs.get(ck);
    if (!out) { out = await sharp(await storage().get(f.storage_key)).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 76 }).toBuffer(); thumbs.set(ck, out); if (thumbs.size > 400) thumbs.delete(thumbs.keys().next().value!); }
    return reply.header('content-type', 'image/webp').header('cache-control', 'private, max-age=300').header('x-content-type-options', 'nosniff').send(out);
  });

  app.patch('/api/files/:id', { preHandler: requireAuth }, async (req, reply) => {
    const f = await loadFile(req, reply); if (!f) return;
    const owner: Owner = f.property_id ? { column: 'property_id', id: f.property_id } : f.person_id ? { column: 'person_id', id: f.person_id } : { column: 'contract_id', id: f.contract_id };
    if (!writePerm(owner, f.category).every((p) => can(req.user!.role, p))) return reply.code(403).send({ error: 'Você não tem permissão para esta ação.' });
    const b = z.object({ caption: z.string().max(200).nullable().optional(), position: z.number().int().min(0).optional(), is_cover: z.literal(true).optional(), visibility: z.enum(['privado', 'publico']).optional() }).parse(req.body);
    if (b.visibility === 'publico' && f.category !== 'foto') return reply.code(400).send({ error: 'Somente fotos podem ser públicas.' });
    if (b.is_cover && f.category !== 'foto') return reply.code(400).send({ error: 'Somente fotos podem ser capa.' });
    const row = await tx(async (c) => {
      if (b.is_cover) await c.query(`UPDATE files SET is_cover=false WHERE org_id=$1 AND property_id=$2`, [req.user!.orgId, f.property_id]);
      return (await c.query(`UPDATE files SET caption=COALESCE($3,caption), position=COALESCE($4,position), is_cover=COALESCE($5,is_cover), visibility=COALESCE($6,visibility) WHERE id=$1 AND org_id=$2 RETURNING *`, [f.id, req.user!.orgId, b.caption === undefined ? null : b.caption, b.position ?? null, b.is_cover ?? null, b.visibility ?? null])).rows[0];
    });
    await audit(req, 'file.update', 'file', f.id, b);
    return pub(row);
  });

  app.delete('/api/files/:id', { preHandler: requireAuth }, async (req, reply) => {
    const f = await loadFile(req, reply); if (!f) return;
    const owner: Owner = f.property_id ? { column: 'property_id', id: f.property_id } : f.person_id ? { column: 'person_id', id: f.person_id } : { column: 'contract_id', id: f.contract_id };
    if (!writePerm(owner, f.category).every((p) => can(req.user!.role, p))) return reply.code(403).send({ error: 'Você não tem permissão para esta ação.' });
    await tx(async (c) => {
      await c.query('DELETE FROM files WHERE id=$1 AND org_id=$2', [f.id, req.user!.orgId]);
      if (f.is_cover) await c.query(`UPDATE files SET is_cover=true WHERE id=(SELECT id FROM files WHERE org_id=$1 AND property_id=$2 AND category='foto' ORDER BY position LIMIT 1)`, [req.user!.orgId, f.property_id]);
    });
    await storage().del(f.storage_key).catch(() => {});
    await audit(req, 'file.delete', 'file', f.id);
    return { ok: true };
  });
}
