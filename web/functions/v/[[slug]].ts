// Cloudflare Pages Function: vitrine /v/:slug são renderizadas pela API (prévia de WhatsApp/SEO).
export const onRequest = async (ctx: any) => {
  const origin: string | undefined = ctx.env.API_ORIGIN;
  if (!origin) return new Response('API_ORIGIN não configurada.', { status: 503 });
  const url = new URL(ctx.request.url);
  return fetch(new Request(origin + url.pathname + url.search, ctx.request));
};
