import fs from 'node:fs/promises';
import path from 'node:path';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { config } from './config.js';

export interface Storage {
  put(key: string, data: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer>;
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
  async del(key: string) { await this.c.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: key })); }
}

let inst: Storage | null = null;
export const storage = (): Storage => (inst ??= config.storageDriver === 's3' ? new S3Storage() : new LocalStorage());

/** Detecta o tipo real pelo conteúdo (não confia no nome nem no Content-Type enviado). */
export function sniffMime(b: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (b.length > 5 && b.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}
