import type { FastifyReply, FastifyRequest } from 'fastify';
import { storage } from './storage.js';

const CHUNK = 2 * 1024 * 1024; // resposta parcial máxima: evita carregar o vídeo inteiro na memória do servidor gratuito

/** Interpreta "Range: bytes=a-b" (um único intervalo). null = sem Range; 'invalid' = 416. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | 'invalid' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid';
  let start: number, end: number;
  if (m[1] === '') { const n = Number(m[2]); if (n <= 0) return 'invalid'; start = Math.max(0, size - n); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= size || start > end) return 'invalid';
  return { start, end: Math.min(end, start + CHUNK - 1) };
}

/** Entrega um arquivo de mídia com suporte a Range (necessário para <video> avançar/rebobinar e para o Safari). */
export async function sendMedia(req: FastifyRequest, reply: FastifyReply, f: { storage_key: string; mime: string; size_bytes: number }, cache: string) {
  reply.header('content-type', f.mime).header('accept-ranges', 'bytes').header('x-content-type-options', 'nosniff').header('cache-control', cache);
  const r = parseRange(req.headers.range, f.size_bytes);
  if (r === 'invalid') return reply.code(416).header('content-range', `bytes */${f.size_bytes}`).send();
  if (!r) return reply.send(await storage().get(f.storage_key));
  const body = await storage().range(f.storage_key, r.start, r.end);
  return reply.code(206).header('content-range', `bytes ${r.start}-${r.end}/${f.size_bytes}`).header('content-length', body.length).send(body);
}
