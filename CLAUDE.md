# ImobFlow — fluxo de trabalho

## Publicação (autorizado pelo dono do projeto)
Toda alteração pedida deve ser publicada, sem precisar perguntar de novo:
1. Rodar `npm -w server run typecheck` e `npm test` (e `npm run build` se mexer no `web/`). Não publicar com teste falhando.
2. Commit com mensagem descritiva e push para `claude/keen-edison-2dosax` **e** `main` (as duas ficam iguais).
3. A Cloudflare (Workers Builds, Worker `corretor`) publica sozinha a cada push em `main`; o Worker aplica as migrações pendentes na primeira requisição. O workflow `deploy-cloudflare.yml` é só uma alternativa manual. O Render não é mais usado.
4. Conferir `<PUBLIC_ORIGIN>/api/health` (deve responder `{"ok":true,"db":"ok",...}`) e informar o resultado; com configuração incompleta ele lista o que falta.

Limites: não abrir PR nem mexer em outra branch sem pedido; nunca versionar segredos (`DATABASE_URL`, senhas, `.env`); não rodar SQL destrutivo no Neon `production` sem confirmação.

## Banco
Neon, projeto `square-truth-49115411`. Migrações em `server/src/db/migrations` rodam na subida da API (Node) e na primeira requisição do Worker; toda migração nova também entra em `server/src/db/migrations.bundle.ts` (um teste confere). Testes usam `TEST_DATABASE_URL` (banco "test", nunca produção). Detalhes em `docs/DEPLOY.md`.
