# Deploy: Cloudflare Workers (gratuito, sem cartão) + Neon

## Visão geral
Um único **Cloudflare Worker** serve a API (`/api`), as páginas públicas (`/p`, `/v`, `sitemap.xml`, `robots.txt`) e o app web (arquivos estáticos do `web/dist`, via Workers Assets). O banco é o Postgres do Neon; fotos e vídeos ficam no próprio Postgres (`STORAGE_DRIVER=db`), sem R2 e sem cartão.
- Código do Worker: `server/src/worker.ts`; configuração: `wrangler.jsonc` (na raiz).
- O mesmo código roda em Node (`npm -w server run dev`, testes e hospedagem própria) e no Worker: a camada HTTP (`server/src/http/mini.ts`) usa só `Request`/`Response`. O Fastify foi removido porque o roteador dele usa `new Function`, proibido no Workers.
- Local: crie um `.dev.vars` na raiz (DATABASE_URL, FORM_SECRET, PUBLIC_ORIGIN, COOKIE_SECURE=false, NODE_ENV=development), rode `npm run build` e `npm -w server run worker:dev` (http://localhost:8787).

## Opção A — pelo painel da Cloudflare (Workers Builds, sem GitHub Actions)
1. Workers & Pages → **Create → Import a repository** → escolha o repositório do ImobFlow e a branch `main`. O **nome do Worker deve ser `imobflow`** (igual ao `name` do `wrangler.jsonc`).
2. **Build command:** `npm run cf:build` (compila o web e aplica as migrações no Neon). **Deploy command:** `npx wrangler deploy --var GIT_COMMIT:$WORKERS_CI_COMMIT_SHA`. Diretório raiz: `/` (vazio).
3. Em **Settings → Build → Variables and secrets** (variáveis de build), crie `DATABASE_URL` (Neon production, com `?sslmode=require`).
4. Em **Settings → Variables and Secrets** (variáveis do Worker), crie como **Secret**: `DATABASE_URL`, `FORM_SECRET` (≥ 24 caracteres aleatórios) e `PUBLIC_ORIGIN` (a URL https final do Worker, ex. `https://imobflow.SEUSUBDOMINIO.workers.dev`). Secrets sobrevivem aos deploys; variáveis comuns criadas no painel são apagadas a cada deploy.
5. Dispare um novo build (**Deployments → Retry** ou novo push). Cada push em `main` publica sozinho.

## Opção B — GitHub Actions (precisa da sua conta Cloudflare)
1. Crie conta em cloudflare.com (não pede cartão). Em **My Profile → API Tokens → Create Token**, use o modelo **Edit Cloudflare Workers**. Anote também o **Account ID** (página inicial da conta, coluna direita).
2. Em **Workers & Pages** abra **Overview**/**Settings** e registre seu subdomínio `workers.dev` (a URL ficará `https://imobflow.<subdominio>.workers.dev`). Domínio próprio pode ser ligado depois em Settings → Domains.
3. No GitHub: **Settings → Secrets and variables → Actions**
   - Segredos: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DATABASE_URL` (Neon `production`, com `?sslmode=require`), `FORM_SECRET` (≥ 24 caracteres aleatórios).
   - Variável: `PUBLIC_ORIGIN` = a URL https final do Worker (links da vitrine, vCard, mapa e cookies usam essa origem).
4. Faça push em `main` ou `claude/keen-edison-2dosax` (ou rode o workflow manualmente): `deploy-cloudflare.yml` compila, aplica as migrações no Neon, publica com `wrangler deploy`, grava os segredos no Worker e confere `/api/health` até o campo `commit` bater com o commit enviado. Sem os segredos o job só avisa e é ignorado.
5. Entre com sua conta. **Contas criadas antes desta mudança têm senha em argon2, que o Worker não lê**: redefina com `DATABASE_URL=… npm -w server run reset-password -- seu@email.com 'NovaSenha123'` (não é preciso fazer isso para contas novas).

## Limites do plano gratuito (leia)
- **CPU por requisição: 10 ms.** Login/cadastro usam PBKDF2-SHA512 com 100.000 iterações (máximo do Workers). Isso pode estourar os 10 ms; se aparecer erro 1102/“exceeded CPU” no login, as saídas são reduzir `PBKDF2_ITERATIONS` (menos seguro) ou assinar o plano pago do Workers (US$ 5/mês, exige cartão). Não consegui medir isso fora do Cloudflare; confirme no primeiro acesso.
- 100.000 requisições/dia; corpo de requisição até 100 MB (os vídeos do app têm limite de 30 MB).
- Sem `sharp` no Worker: o **app web reduz e limpa as fotos no navegador** antes de enviar (máx. 2000 px, sem EXIF/GPS) e o servidor valida o tipo e remove EXIF de JPEG. Miniaturas são a própria imagem (o navegador reduz). O cartão de visita em PNG vira SVG no Worker.
- Limite de requisições (anti-abuso) é por instância do Worker, ou seja, aproximado; para proteção forte use Cloudflare Turnstile (`TURNSTILE_*`) e regras de rate limit do painel.
- Armazenamento: `STORAGE_DRIVER=db` usa a cota do Neon (≈ 0,5 GB). `STORAGE_DRIVER=s3` não está disponível no Worker.

## Banco: Neon
- Projeto `my-first-project` (`square-truth-49115411`, aws-sa-east-1, Postgres 18). Branch `production` (banco `neondb`) e branch `test` (banco `imobflow_test`).
- As migrações até `009` já estão aplicadas em `production` e registradas em `schema_migrations`; `npm run migrate` (ou a subida da API) só aplica as novas.
- `DATABASE_URL` (com `?sslmode=require`) fica só nos segredos do GitHub/Cloudflare; nunca no repositório. As migrações novas (`011`+) são aplicadas pelo workflow de deploy antes de publicar.
- Segurança: a migração `010_rls.sql` liga RLS (sem políticas) em todas as tabelas e revoga acessos de `PUBLIC`; a API conecta como dono das tabelas. Se um dia usar a Data API do Neon ou outro role, será preciso criar políticas explícitas.
- Testes: `TEST_DATABASE_URL=<url da branch test, banco imobflow_test> npm test`. O setup zera o schema `public`, por isso só aceita URLs com "test" no nome. O CI continua usando Postgres em container.

## Primeiro uso
1. Crie sua conta em `/cadastrar`. Para tirar os limites do plano gratuito na sua organização: `UPDATE organizations SET plan='ilimitado' WHERE slug='…'`.
2. Agende `scripts/backup.sh` (cron) e teste uma restauração.
3. Envie `/sitemap.xml` ao Google Search Console.

## Google Agenda
Assinatura por URL (somente leitura): Agenda → Assinar → gerar link → Google Agenda “Do URL”. Sincronização com escrita via OAuth **não** foi implementada (exige projeto no Google Cloud e verificação do app).


## Atualizações do app (PWA)
- `web/public/_headers` define `sw.js`/`index.html` sem cache e `assets/` imutáveis (valem nos Workers Assets).
- Usuários veem "Nova versão disponível — Atualizar agora"; o app só recarrega quando a pessoa toca.

## Hospedagem própria (opcional)
`npm ci && npm run build && npm start` com as variáveis do `.env.example` (`WEB_DIST=./web/dist`) roda a mesma API em Node (aqui o `sharp` e o `STORAGE_DRIVER=s3`/`local` funcionam). Cloudflare Tunnel expõe de graça.

## Firebase
O Firebase gratuito (Spark) só hospeda site estático e não roda API nem Postgres; App Hosting exige Blaze (cartão) e o Firestore exigiria reescrever o banco. Não é usado.
