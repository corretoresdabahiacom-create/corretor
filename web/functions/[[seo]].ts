// Cloudflare Pages Function: /robots.txt e /sitemap.xml vêm da API (listam só páginas públicas).
export const onRequest = async (ctx: any) => {
  const origin: string | undefined = ctx.env.API_ORIGIN;
  const path = new URL(ctx.request.url).pathname;
  if (!origin || !['/robots.txt', '/sitemap.xml'].includes(path)) return ctx.next();
  return fetch(origin + path);
};
