// Servidor HTTP do Node para o mesmo HttpApp (uso local e hospedagem em servidor próprio).
import http from 'node:http';
import type { HttpApp } from './mini.js';

export function listen(app: HttpApp, o: { port: number; host: string }): Promise<http.Server> {
  const server = http.createServer(async (inc, out) => {
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const c of inc) { size += (c as Buffer).length; if (size > 45 * 1024 * 1024) { out.writeHead(413).end(); return; } chunks.push(c as Buffer); }
      const headers = new Headers(); for (const [k, v] of Object.entries(inc.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
      const method = inc.method ?? 'GET';
      const res = await app.fetch(new Request(`http://${inc.headers.host ?? 'localhost'}${inc.url}`, { method, headers, body: ['GET', 'HEAD'].includes(method) ? undefined : new Uint8Array(Buffer.concat(chunks)) }), { ip: inc.socket.remoteAddress ?? '127.0.0.1' });
      const h: Record<string, string | string[]> = {};
      res.headers.forEach((v, k) => { if (k !== 'set-cookie') h[k] = v; });
      const sc = res.headers.getSetCookie(); if (sc.length) h['set-cookie'] = sc;
      out.writeHead(res.status, h).end(Buffer.from(await res.arrayBuffer()));
    } catch (e) { console.error(e); if (!out.headersSent) out.writeHead(500, { 'content-type': 'application/json' }); out.end('{"error":"Erro interno."}'); }
  });
  return new Promise((resolve) => server.listen(o.port, o.host, () => resolve(server)));
}
