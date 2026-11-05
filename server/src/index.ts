import { buildApp } from './app.js';
import { config, assertProductionConfig } from './lib/config.js';
import { migrate } from './db/migrate.js';

assertProductionConfig();
const ran = await migrate();
if (ran.length) console.log('Migrações aplicadas:', ran.join(', '));
const app = await buildApp({ logger: true });
await app.listen({ port: config.port, host: config.host });
