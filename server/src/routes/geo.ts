import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePerm } from '../lib/auth.js';
import { geocode } from '../lib/geo.js';

export async function geoRoutes(app: FastifyInstance) {
  // "Localizar pelo endereço" no cadastro do imóvel. O texto vai para o serviço do OpenStreetMap; nenhum dado de pessoas é enviado.
  app.get('/api/geocode', { preHandler: requirePerm('properties.write'), config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { q } = z.object({ q: z.string().trim().min(5, 'Informe o endereço.').max(200) }).parse(req.query);
    try {
      const hit = await geocode(q);
      return hit ?? reply.code(404).send({ error: 'Endereço não encontrado. Confira rua, cidade e UF ou informe as coordenadas.' });
    } catch {
      return reply.code(502).send({ error: 'O serviço de mapas não respondeu. Tente de novo em instantes.' });
    }
  });
}
