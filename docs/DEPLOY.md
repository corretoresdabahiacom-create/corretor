# Deploy gratuito: GitHub + Cloudflare (+ Firebase opcional)

## Visão geral
Um único processo Node (a API) serve também o app web e as páginas públicas. O Cloudflare fica na frente.
- **GitHub:** código e CI (`ci.yml`: testes com Postgres + build). `deploy-web.yml` publica `web/dist` no Cloudflare Pages (segredos `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` e variável `CF_PAGES_PROJECT`).
- **Banco:** PostgreSQL gratuito externo (Neon ou Supabase free). `DATABASE_URL` só em segredos.
- **API:** `npm ci && npm run build && npm start` com as variáveis de produção do `.env.example`. Hospedagem gratuita real: sua máquina/servidor + **Cloudflare Tunnel** (grátis). Firebase App Hosting exige plano Blaze (cartão).
- **Cloudflare Pages (opcional):** `web/functions/*` repassam `/api`, `/p`, `/robots.txt`, `/sitemap.xml` para `API_ORIGIN`. Mais simples: apontar o domínio direto para o Tunnel (tudo na mesma origem).
- **Arquivos:** `STORAGE_DRIVER=s3` com Cloudflare R2 (cota gratuita; exige cartão) ou disco local com backup.
- **E-mail:** `EMAIL_DRIVER=resend` (plano gratuito, domínio verificado). Sem e-mail, convites seguem com link manual.

## Banco: Neon
- Projeto `my-first-project` (`square-truth-49115411`, aws-sa-east-1, Postgres 18). Branch `production` (banco `neondb`) e branch `test` (banco `imobflow_test`).
- As 9 migrações (`001`–`009`) já estão aplicadas em `production` e registradas em `schema_migrations`; `npm run migrate` (ou a subida da API) só aplica as novas.
- `DATABASE_URL` (com `?sslmode=require`) fica só nos segredos do host da API; nunca no repositório.
- Testes: `TEST_DATABASE_URL=<url da branch test, banco imobflow_test> npm test`. O setup zera o schema `public`, por isso só aceita URLs com "test" no nome. O CI continua usando Postgres em container.

## Primeiro deploy
1. Gere `FORM_SECRET` (≥24 caracteres); defina `PUBLIC_ORIGIN=https://…`, `COOKIE_SECURE=true`, `TRUST_PROXY=true`, `WEB_DIST=./web/dist`.
2. A API migra o banco ao iniciar (ou `npm run migrate`).
3. Crie sua conta em `/cadastrar`. Para tirar os limites do plano gratuito na sua própria organização: `UPDATE organizations SET plan='ilimitado' WHERE slug='…'`.
4. Agende `scripts/backup.sh` (cron) e teste uma restauração.
5. Envie `/sitemap.xml` ao Google Search Console.

## Google Agenda
Assinatura por URL (somente leitura): Agenda → Assinar → gerar link → Google Agenda “Do URL”. Sincronização com escrita via OAuth **não** foi implementada (exige projeto no Google Cloud e verificação do app).


## Atualizações do app (PWA)
- Depois de um novo `npm run build`, **reinicie a API** quando ela servir o `web/dist` (os arquivos são registrados na inicialização).
- No Cloudflare Pages, o arquivo `web/public/_headers` já define `sw.js`/`index.html` sem cache e `assets/` imutáveis.
- Usuários veem "Nova versão disponível — Atualizar agora"; o app só recarrega quando a pessoa toca.
