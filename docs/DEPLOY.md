# Deploy gratuito: GitHub + Cloudflare (+ Firebase opcional)

## Visão geral
Um único processo Node (a API) serve também o app web e as páginas públicas. O Cloudflare fica na frente.
- **GitHub:** código e CI (`ci.yml`: testes com Postgres + build). `deploy-web.yml` publica `web/dist` no Cloudflare Pages (segredos `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` e variável `CF_PAGES_PROJECT`).
- **Banco:** PostgreSQL gratuito externo (Neon ou Supabase free). `DATABASE_URL` só em segredos.
- **API:** `npm ci && npm run build && npm start` com as variáveis de produção do `.env.example`. Hospedagem gratuita real: sua máquina/servidor + **Cloudflare Tunnel** (grátis). Firebase App Hosting exige plano Blaze (cartão).
- **Cloudflare Pages (opcional):** `web/functions/*` repassam `/api`, `/p`, `/v` (vitrine, `.vcf`), `/vendor` (mapa), `/robots.txt`, `/sitemap.xml` para `API_ORIGIN` (testado localmente com `cd web && npx wrangler@3 pages dev dist --binding API_ORIGIN=http://localhost:3001`). Mais simples: apontar o domínio direto para o Tunnel (tudo na mesma origem).
- **Arquivos:** `STORAGE_DRIVER=s3` com Cloudflare R2 (cota gratuita; exige cartão) ou disco local com backup.
- **E-mail:** `EMAIL_DRIVER=resend` (plano gratuito, domínio verificado). Sem e-mail, convites seguem com link manual.

## Banco: Neon
- Projeto `my-first-project` (`square-truth-49115411`, aws-sa-east-1, Postgres 18). Branch `production` (banco `neondb`) e branch `test` (banco `imobflow_test`).
- As 9 migrações (`001`–`009`) já estão aplicadas em `production` e registradas em `schema_migrations`; `npm run migrate` (ou a subida da API) só aplica as novas.
- `DATABASE_URL` (com `?sslmode=require`, obrigatório em produção para hosts remotos) fica só nos segredos do host da API; nunca no repositório.
- Segurança: a migração `010_rls.sql` liga RLS (sem políticas) em todas as tabelas e revoga acessos de `PUBLIC`; a API conecta como dono das tabelas. Se um dia usar a Data API do Neon ou outro role, será preciso criar políticas explícitas.
- Testes: `TEST_DATABASE_URL=<url da branch test, banco imobflow_test> npm test`. O setup zera o schema `public`, por isso só aceita URLs com "test" no nome. O CI continua usando Postgres em container.

## Hospedagem gratuita da API: Render
O `render.yaml` na raiz configura tudo (Node 22, build do web + API no mesmo serviço, health check em `/api/health`).
1. Em render.com, crie a conta com o GitHub (não pede cartão) e escolha **New → Blueprint**; selecione este repositório e a branch desejada.
2. Quando pedir, preencha `DATABASE_URL` (connection string do Neon `production`, com `?sslmode=require`) e `PUBLIC_ORIGIN` (`https://imobflow.onrender.com`, ou a URL que o Render mostrar; pode ajustar depois em Environment).
3. Após o primeiro deploy, abra a URL do serviço e crie sua conta em `/cadastrar`.
Limitações do plano gratuito:
- O serviço hiberna após ~15 min sem acesso; o primeiro acesso seguinte leva cerca de 1 minuto.
- O disco é efêmero, por isso o `render.yaml` já define `STORAGE_DRIVER=db`: fotos e documentos ficam numa tabela do Postgres (`blobs`, migração 011), sem cartão e sem perder nada em deploy/reinício. Limite prático: a cota do banco (Neon free ≈ 0,5 GB; fotos da vitrine são reprocessadas e ficam pequenas, PDFs de até 10 MB pesam mais). Para volume maior use `STORAGE_DRIVER=s3` (Cloudflare R2 exige cartão). O Neon Object Storage não está disponível na região São Paulo deste projeto.
- Não há região em São Paulo; `virginia` é a mais próxima do Neon.

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

## Deploy automático e verificação
- A cada push em `claude/keen-edison-2dosax` (ou `main`), o Render publica sozinho e o workflow `deploy-check.yml` espera a versão nova: consulta `/api/health` até o campo `commit` ser igual ao commit enviado (até 20 min, cobrindo o despertar do plano gratuito) e testa `/`, `/manifest.webmanifest` e `/robots.txt`. Falhou = o job fica vermelho no GitHub.
- A URL verificada vem da variável de repositório `APP_URL` (padrão: `https://imobflow-d0r2.onrender.com`).
- `deploy-web.yml` (Cloudflare Pages) só roda se existir a variável `CF_PAGES_PROJECT`; sem ela o Render serve o app inteiro e o job é ignorado em vez de falhar.


## Passo a passo: Cloudflare Pages (precisa da sua conta)
1. Cloudflare > Workers & Pages > Create > Pages > criar projeto (Direct Upload) com o nome desejado.
2. Nas configurações do projeto, variável de ambiente `API_ORIGIN` = `https://imobflow-d0r2.onrender.com`.
3. No GitHub (Settings > Secrets and variables > Actions): segredos `CLOUDFLARE_API_TOKEN` (permissão Cloudflare Pages: Edit) e `CLOUDFLARE_ACCOUNT_ID`; variável `CF_PAGES_PROJECT` = nome do projeto.
4. No Render, `PUBLIC_ORIGIN` = domínio final do Pages (links da vitrine, vCard e mapa usam essa origem).
5. A cada push em `main` ou na branch de deploy, `deploy-web.yml` publica. Nunca coloque o token no repositório.

## Firebase
O Firebase gratuito (Spark) só hospeda site estático: não roda a API Node nem o Postgres. Firebase App Hosting exige Blaze (cartão) e Firestore exigiria reescrever a camada de dados. Por isso a API fica no Render + Neon e o Cloudflare na frente.
