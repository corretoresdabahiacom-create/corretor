# Deploy: Cloudflare Workers (gratuito, sem cartão) + Neon

## Visão geral
Um único **Cloudflare Worker** serve a API (`/api`), as páginas públicas (`/p`, `/v`, `sitemap.xml`, `robots.txt`) e o app web (arquivos estáticos do `web/dist`, via Workers Assets). O banco é o Postgres do Neon; fotos e vídeos ficam no próprio Postgres (`STORAGE_DRIVER=db`), sem R2 e sem cartão.
- Código do Worker: `server/src/worker.ts`; configuração: `wrangler.jsonc` (na raiz).
- O mesmo código roda em Node (`npm -w server run dev`, testes e hospedagem própria) e no Worker: a camada HTTP (`server/src/http/mini.ts`) usa só `Request`/`Response`. O Fastify foi removido porque o roteador dele usa `new Function`, proibido no Workers.
- Local: crie um `.dev.vars` na raiz (DATABASE_URL, FORM_SECRET, PUBLIC_ORIGIN, COOKIE_SECURE=false), rode `npm run build` e `npm -w server run worker:dev` (http://localhost:8787). Atenção: o `wrangler dev` compila com `NODE_ENV=development` e o `wrangler deploy` com `production`; para simular produção localmente use `--define 'process.env.NODE_ENV:"production"'`.

## Como está publicado hoje (Workers Builds, pelo painel)
O Worker `corretor` está ligado ao repositório no painel da Cloudflare e **publica sozinho a cada push em `main`**.
- **Build command:** `npm run build` · **Deploy command:** `npx wrangler deploy` · **Root directory:** `/`. Funciona assim; opcionalmente, use `npx wrangler deploy --var GIT_COMMIT:$WORKERS_CI_COMMIT_SHA` para o `/api/health` mostrar o commit no ar.
- **Migrações:** o próprio Worker aplica as pendentes na primeira requisição depois de cada deploy (estão embutidas no bundle; trava no banco evita aplicar duas vezes). Não é preciso rodar nada no build. `AUTO_MIGRATE=false` desliga.
- **Segredos do Worker** (Settings → Variables and Secrets, tipo **Secret**): `DATABASE_URL` (Neon `production`, terminando em `?sslmode=require`), `FORM_SECRET` (≥ 24 caracteres aleatórios, ex.: `openssl rand -hex 32`) e `PUBLIC_ORIGIN` (o endereço https do Worker, ex. `https://corretor.SEUSUBDOMINIO.workers.dev`, sem barra no fim — se vier com barra, o app tolera). Segredos sobrevivem aos deploys; variáveis comuns criadas no painel são apagadas a cada deploy.
- **Faltou algo?** Em vez do "Error 1101" genérico, o Worker responde 503 dizendo **quais** itens faltam (só os nomes, nunca os valores) — no app, na vitrine e em `/api/health`.
- O **nome do Worker** no painel tem de ser igual ao `name` do `wrangler.jsonc` (hoje `corretor`).
- Não use `web/public/_redirects`: no Worker o roteamento do app fica no `wrangler.jsonc` (`not_found_handling`), e o arquivo faz a Cloudflare recusar o deploy.

## Alternativa manual — GitHub Actions
`deploy-cloudflare.yml` só roda quando acionado à mão (Actions → Run workflow), para não publicar em dobro junto com o painel. Precisa, no GitHub (Settings → Secrets and variables → Actions), dos segredos `CLOUDFLARE_API_TOKEN` (modelo **Edit Cloudflare Workers**), `CLOUDFLARE_ACCOUNT_ID`, `DATABASE_URL`, `FORM_SECRET` e da variável `PUBLIC_ORIGIN`. Ele compila, aplica as migrações, publica, grava os segredos e confere `/api/health`.

## Contas antigas (senha argon2)
Contas criadas antes da mudança para o Cloudflare têm senha em argon2, que o Worker não consegue conferir. Ao tentar entrar, a pessoa vê "Esta conta foi criada antes da mudança de servidor e precisa de uma nova senha" (não mais "senha incorreta"). Para redefinir: `DATABASE_URL=… npm -w server run reset-password -- email@exemplo.com 'NovaSenha123'` (encerra as sessões antigas). Se a conta entrar alguma vez pelo servidor Node, a senha é regravada sozinha no formato novo.

## Limites do plano gratuito (leia)
- **CPU: 10 ms por requisição.** Requisições comuns ficam bem abaixo. Login e cadastro usam PBKDF2-SHA512 com 100.000 iterações (máximo do Workers) e passam disso; a Cloudflare tolera estouros ocasionais e só interrompe Workers que estouram **de forma constante** (erro 1102). Se o login começar a falhar com 1102, as saídas são reduzir `PBKDF2_ITERATIONS` (menos seguro; contas existentes continuam entrando) ou o plano pago (US$ 5/mês, exige cartão).
- Memória: 128 MB por isolate — por isso os caches de imagens são limitados por bytes (12 MB cada no Worker).
- 100.000 requisições/dia; corpo de requisição até 100 MB (vídeos do app: até 30 MB); até 6 conexões simultâneas por requisição (o Worker usa no máximo 3 com o banco).
- Sem `sharp` no Worker: o **app web reduz e limpa as fotos no navegador** antes de enviar (máx. 2000 px, sem EXIF/GPS) e o servidor valida o tipo e remove EXIF de JPEG. Miniaturas são a própria imagem (o navegador reduz). O cartão de visita em PNG vira SVG no Worker.
- Limite de requisições (anti-abuso) é por instância do Worker, ou seja, aproximado; para proteção forte use Cloudflare Turnstile (`TURNSTILE_*`) e regras de rate limit do painel.
- Armazenamento: `STORAGE_DRIVER=db` usa a cota do Neon (≈ 0,5 GB). `STORAGE_DRIVER=s3` não está disponível no Worker.
- Fonte: [Workers — limits](https://developers.cloudflare.com/workers/platform/limits/) (consultado em 17/11/2026).

## Segurança do app estático
O app web (HTML/JS/CSS) é servido direto pelos Workers Assets, sem passar pela API. Os cabeçalhos de segurança (CSP, HSTS, X-Frame-Options etc.) estão em `web/public/_headers`, cópia exata de `server/src/http/security.ts`; um teste falha se divergirem.

## Banco: Neon
- Projeto `my-first-project` (`square-truth-49115411`, aws-sa-east-1, Postgres 18). Branch `production` (banco `neondb`) e branch `test` (banco `imobflow_test`).
- Em 17/11/2026 as 14 migrações (`001`–`014`) estavam aplicadas em `production` e registradas em `schema_migrations`. As novas são aplicadas pelo Worker (ou por `npm run migrate` / pela subida da API em Node), sempre só as que faltam.
- `DATABASE_URL` (com `?sslmode=require`) fica só nos segredos do Cloudflare/GitHub; nunca no repositório.
- Toda migração nova precisa entrar também em `server/src/db/migrations.bundle.ts` (o Worker não lê a pasta); o teste `worker.test.ts` falha se faltar.
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
