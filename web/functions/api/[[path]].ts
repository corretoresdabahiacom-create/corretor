// Cloudflare Pages Function: encaminha /api/* para a API (mesma origem => cookies de sessão funcionam).
// Defina API_ORIGIN em Pages > Settings > Variables (ex.: https://api.seudominio.com).
export const onRequest = async (ctx: any) => {
  const origin: string | undefined = ctx.env.API_ORIGIN;
  if (!origin) return new Response(JSON.stringify({ error: 'API_ORIGIN não configurada.' }), { status: 503, headers: { 'content-type': 'application/json' } });
  const url = new URL(ctx.request.url);
  return fetch(new Request(origin + url.pathname + url.search, ctx.request));
};
