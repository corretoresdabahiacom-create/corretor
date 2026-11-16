import { createApp } from './http/mini.js';
import { securityHeaders } from './http/security.js';
import { ZodError } from 'zod';
import { config } from './lib/config.js';
import { authRoutes } from './routes/auth.js';
import { peopleRoutes } from './routes/people.js';
import { propertyRoutes } from './routes/properties.js';
import { dealRoutes } from './routes/deals.js';
import { eventRoutes } from './routes/events.js';
import { insightRoutes } from './routes/insights.js';
import { fileRoutes } from './routes/files.js';
import { portalRoutes } from './routes/portal.js';
import { calendarRoutes } from './routes/calendar.js';
import { vitrineRoutes } from './routes/vitrine.js';
import { seoRoutes } from './routes/seo.js';
import { contractRoutes } from './routes/contracts.js';
import { contractFinanceRoutes } from './routes/contractFinance.js';
import { geoRoutes } from './routes/geo.js';
import { privacyRoutes } from './routes/privacy.js';

export async function buildApp(opts: { logger?: boolean; rateLimit?: boolean } = {}) {
  const app = createApp({ bodyLimit: 2 * 1024 * 1024, trustProxy: config.trustProxy, rateLimit: opts.rateLimit });

  securityHeaders(app, {
    'default-src': ["'self'"],
    // 'unsafe-inline' é necessário para o script/estilo da página pública /p (conteúdo sempre escapado e testado).
    'script-src': ["'self'", "'unsafe-inline'", 'https://challenges.cloudflare.com'],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'https://tile.openstreetmap.org'], // tiles do mapa (OpenStreetMap)
    'frame-src': ["'self'", 'https://challenges.cloudflare.com', 'https://www.youtube-nocookie.com', 'https://player.vimeo.com'],
    'connect-src': ["'self'"],
    'object-src': ["'none'"],
    'frame-ancestors': ["'self'"], // o editor do site mostra a pré-visualização em iframe da mesma origem
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
  });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return reply.code(400).send({ error: first?.message ?? 'Dados inválidos.', fields: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    const code = (err as any).statusCode ?? 500;
    if (code >= 500) {
      if (process.env.LOG_ERRORS) console.error(err);
      app.log.error({ err: { message: err.message } }, 'erro interno');
      return reply.code(500).send({ error: 'Algo deu errado. Tente novamente em instantes.' });
    }
    return reply.code(code).send({ error: err.message });
  });

  app.get('/api/health', async () => ({ ok: true, app: config.appName, runtime: (globalThis as any).navigator?.userAgent?.startsWith('Cloudflare') ? 'cloudflare-workers' : 'node', commit: (process.env.GIT_COMMIT ?? '').slice(0, 7) || undefined }));

  await app.register(authRoutes);
  await app.register(peopleRoutes);
  await app.register(propertyRoutes);
  await app.register(dealRoutes);
  await app.register(eventRoutes);
  await app.register(insightRoutes);
  await app.register(fileRoutes);
  await app.register(contractRoutes);
  await app.register(contractFinanceRoutes);
  await app.register(geoRoutes);
  await app.register(privacyRoutes);
  await app.register(portalRoutes);
  await app.register(calendarRoutes);
  await app.register(vitrineRoutes);
  await app.register(seoRoutes);
  if (config.webDist) {
    const { staticFallback } = await import('./http/static.js');
    app.setNotFoundHandler(staticFallback(config.webDist));
  }
  return app;
}
