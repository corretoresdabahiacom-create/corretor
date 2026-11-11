import fs from 'node:fs/promises';
import path from 'node:path';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { config } from './config.js';
import { q, q1 } from '../db/pool.js';

export interface Storage {
  put(key: string, data: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Bytes [start, end] (inclusivo) — usado para vídeo (Range). */
  range(key: string, start: number, end: number): Promise<Buffer>;
  del(key: string): Promise<void>;
}

const SAFE_KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}$/; // orgId/fileId — nunca usa nome do usuário

class LocalStorage implements Storage {
  private p(key: string) {
    if (!SAFE_KEY.test(key)) throw new Error('chave inválida');
    return path.resolve(config.storageDir, key);
  }
  async put(key: string, data: Buffer) { const f = this.p(key); await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, data, { flag: 'wx' }); }
  async get(key: string) { return fs.readFile(this.p(key)); }
  async range(key: string, start: number, end: number) {
    const h = await fs.open(this.p(key), 'r');
    try { const b = Buffer.alloc(end - start + 1); const { bytesRead } = await h.read(b, 0, b.length, start); return b.subarray(0, bytesRead); } finally { await h.close(); }
  }
  async del(key: string) { await fs.rm(this.p(key), { force: true }); }
}

class S3Storage implements Storage {
  private c = new S3Client({
    region: config.s3.region, endpoint: config.s3.endpoint, forcePathStyle: true,
    credentials: { accessKeyId: config.s3.accessKeyId ?? '', secretAccessKey: config.s3.secretAccessKey ?? '' },
  });
  async put(key: string, data: Buffer, mime: string) { await this.c.send(new PutObjectCommand({ Bucket: config.s3.bucket, Key: key, Body: data, ContentType: mime })); }
  async get(key: string) {
    const r = await this.c.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  async range(key: string, start: number, end: number) {
    const r = await this.c.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key, Range: `bytes=${start}-${end}` }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  async del(key: string) { await this.c.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: key })); }
}

/** Guarda os arquivos numa tabela do Postgres (bytea). Limite prático: a cota do banco (Neon free ≈ 0,5 GB). */
class DbStorage implements Storage {
  private org(key: string) { if (!SAFE_KEY.test(key)) throw new Error('chave inválida'); return key.split('/')[0]; }
  async put(key: string, data: Buffer, mime: string) {
    await q('INSERT INTO blobs(key,org_id,mime,size,data) VALUES ($1,$2,$3,$4,$5)', [key, this.org(key), mime, data.length, data]);
  }
  async get(key: string) {
    this.org(key);
    const r = await q1<{ data: Buffer }>('SELECT data FROM blobs WHERE key=$1', [key]);
    if (!r) throw Object.assign(new Error('arquivo não encontrado'), { code: 'ENOENT' });
    return r.data;
  }
  async range(key: string, start: number, end: number) {
    this.org(key);
    const r = await q1<{ d: Buffer }>('SELECT substring(data from $2::int for $3::int) AS d FROM blobs WHERE key=$1', [key, start + 1, end - start + 1]);
    if (!r) throw Object.assign(new Error('arquivo não encontrado'), { code: 'ENOENT' });
    return r.d;
  }
  async del(key: string) { this.org(key); await q('DELETE FROM blobs WHERE key=$1', [key]); }
}

let inst: Storage | null = null;
export const storage = (): Storage => (inst ??= config.storageDriver === 's3' ? new S3Storage() : config.storageDriver === 'db' ? new DbStorage() : new LocalStorage());

/** Detecta o tipo real pelo conteúdo (não confia no nome nem no Content-Type enviado). */
export function sniffMime(b: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (b.length > 5 && b.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

const MP4_BRANDS = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'dash']);
/** Vídeo pelo conteúdo: MP4 (marcas comuns de H.264) ou WebM. O servidor NÃO converte: o navegador toca se o codec for compatível. */
export function sniffVideo(b: Buffer): 'video/mp4' | 'video/webm' | null {
  if (b.length > 12 && b.toString('ascii', 4, 8) === 'ftyp' && MP4_BRANDS.has(b.toString('ascii', 8, 12))) return 'video/mp4';
  if (b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
  return null;
}
