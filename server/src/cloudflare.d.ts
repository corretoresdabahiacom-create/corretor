declare module 'cloudflare:workers' { export const env: Record<string, unknown>; }
// Migrações .sql importadas como texto no bundle do Worker (regra "Text" no wrangler.jsonc).
declare module '*.sql' { const sql: string; export default sql; }
