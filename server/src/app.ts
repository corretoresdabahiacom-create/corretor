import Fastify from 'fastify';
import path from 'node:path';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
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
  const app = Fastify({
    logger: opts.logger
      ? { level: 'info', redact: ['req.headers.cookie', 'req.headers.authorization', 'req.body.password'] } // sem segredos nos logs
      : false,
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: config.trustProxy,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // 'unsafe-inline' é necessário para o script/estilo da página pública /p (conteúdo sempre escapado e testado).
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://challenges.cloudflare.com'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https://tile.openstreetmap.org'], // tiles do mapa (OpenStreetMap)
        frameSrc: ["'self'", 'https://challenges.cloudflare.com', 'https://www.youtube-nocookie.com', 'https://player.vimeo.com'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"], // o editor do site mostra a pré-visualização em iframe da mesma origem
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
  });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: config.maxUploadBytes, files: 1, fields: 10 } }); // global: uploads de arquivos e logomarca (vídeo de imóvel sobrescreve o limite na própria rota)
  await app.register(rateLimit, { global: false, max: opts.rateLimit === false ? 100000 : 100, timeWindow: '1 minute' });

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

  app.get('/api/health', async () => ({ ok: true, app: config.appName, commit: (process.env.RENDER_GIT_COMMIT ?? '').slice(0, 7) || undefined }));

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
    const { default: fstatic } = await import('@fastify/static');
    await app.register(fstatic, {
      root: path.resolve(config.webDist), wildcard: false, cacheControl: false,
      // Arquivos com hash (assets/) nunca mudam; o resto (index, sw.js, manifesto) precisa revalidar para o app atualizar.
      setHeaders: (res, file) => {
        if (/[\\/]assets[\\/]/.test(file)) res.header('cache-control', 'public, max-age=31536000, immutable');
        else if (/sw\.js$/.test(file)) { res.header('cache-control', 'no-cache'); res.header('service-worker-allowed', '/'); }
        else if (/\.(html|webmanifest)$/.test(file)) res.header('cache-control', 'no-cache');
        else res.header('cache-control', 'public, max-age=86400');
        if (/\.webmanifest$/.test(file)) res.header('content-type', 'application/manifest+json');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      const u = req.url;
      if (req.method !== 'GET' || u.startsWith('/api/') || u.startsWith('/p/') || u.startsWith('/v/') || u.startsWith('/assets/') || /\.[a-z0-9]{2,5}(\?|$)/i.test(u)) return reply.code(404).send({ error: 'Não encontrado.' });
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    });
  }
  return app;
}
