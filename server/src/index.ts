import { buildApp } from './app.js';
import { config, assertProductionConfig } from './lib/config.js';
import { migrate } from './db/migrate.js';

assertProductionConfig();
const ran = await migrate();
if (ran.length) console.log('Migrações aplicadas:', ran.join(', '));
const app = await buildApp({ logger: true });
const { listen } = await import('./http/node.js');
await listen(app, { port: config.port, host: config.host });
