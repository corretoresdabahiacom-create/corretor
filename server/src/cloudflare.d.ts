declare module 'cloudflare:workers' { export const env: Record<string, unknown>; }
declare module 'cloudflare:node' { export function httpServerHandler(o: { port: number }): { fetch(req: Request, env?: unknown, ctx?: unknown): Promise<Response> }; }
