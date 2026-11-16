// Cabeçalhos de segurança (equivalente ao que o helmet aplicava) — sem dependências, funciona no Workers.
import type { HttpApp } from './mini.js';

export function securityHeaders(app: HttpApp, csp: Record<string, string[]>) {
  const policy = Object.entries({ 'script-src-attr': ["'none'"], 'font-src': ["'self'", 'https:', 'data:'], ...csp })
    .map(([k, v]) => `${k} ${v.join(' ')}`).join('; ') + '; upgrade-insecure-requests';
  const fixed: Record<string, string> = {
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
  app.addSendHook((_req, reply) => { for (const [k, v] of Object.entries(fixed)) if (!reply.headers.has(k)) reply.headers.set(k, v); });
}
