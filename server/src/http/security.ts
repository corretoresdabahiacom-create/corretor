// Cabeçalhos de segurança (equivalente ao que o helmet aplicava) — sem dependências, funciona no Workers.
// A MESMA política vale para o app web servido como arquivo estático pela Cloudflare (web/public/_headers);
// o teste worker.test.ts falha se os dois divergirem.
import type { HttpApp } from './mini.js';

export const CSP_DIRECTIVES: Record<string, string[]> = {
  'default-src': ["'self'"],
  // 'unsafe-inline' é necessário para o script/estilo das páginas públicas (conteúdo sempre escapado e testado).
  'script-src': ["'self'", "'unsafe-inline'", 'https://challenges.cloudflare.com'],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'https://tile.openstreetmap.org'], // tiles do mapa (OpenStreetMap)
  'frame-src': ["'self'", 'https://challenges.cloudflare.com', 'https://www.youtube-nocookie.com', 'https://player.vimeo.com'],
  'connect-src': ["'self'"],
  'object-src': ["'none'"],
  'frame-ancestors': ["'self'"], // o editor do site mostra a pré-visualização em iframe da mesma origem
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
};

export function securityHeaderValues(csp: Record<string, string[]> = CSP_DIRECTIVES): Record<string, string> {
  const policy = Object.entries({ 'script-src-attr': ["'none'"], 'font-src': ["'self'", 'https:', 'data:'], ...csp })
    .map(([k, v]) => `${k} ${v.join(' ')}`).join('; ') + '; upgrade-insecure-requests';
  return {
    'content-security-policy': policy,
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'origin-agent-cluster': '?1',
    // Os tiles do OpenStreetMap exigem o Referer da origem; por isso não usamos "no-referrer".
    'referrer-policy': 'strict-origin-when-cross-origin',
    'strict-transport-security': 'max-age=15552000; includeSubDomains',
    'x-content-type-options': 'nosniff',
    'x-dns-prefetch-control': 'off',
    'x-download-options': 'noopen',
    'x-frame-options': 'SAMEORIGIN',
    'x-permitted-cross-domain-policies': 'none',
    'x-xss-protection': '0',
  };
}

export function securityHeaders(app: HttpApp, csp: Record<string, string[]> = CSP_DIRECTIVES) {
  const fixed = securityHeaderValues(csp);
  app.addSendHook((_req, reply) => { for (const [k, v] of Object.entries(fixed)) if (!reply.headers.has(k)) reply.headers.set(k, v); });
}
