// Copia o Leaflet (mapa das páginas públicas) para web/public/vendor, servido como arquivo estático (Cloudflare Workers não lê node_modules).
import { createRequire } from 'node:module';
import { mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(path.join(root, 'server', 'package.json'));
const out = path.join(root, 'web', 'public', 'vendor');
mkdirSync(out, { recursive: true });
for (const f of ['leaflet.js', 'leaflet.css']) copyFileSync(req.resolve(`leaflet/dist/${f}`), path.join(out, f));
console.log('vendor: leaflet copiado');
