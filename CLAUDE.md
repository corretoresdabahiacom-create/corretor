# ImobFlow — fluxo de trabalho

## Publicação (autorizado pelo dono do projeto)
Toda alteração pedida deve ser publicada, sem precisar perguntar de novo:
1. Rodar `npm -w server run typecheck` e `npm test` (e `npm run build` se mexer no `web/`). Não publicar com teste falhando.
2. Commit com mensagem descritiva e `git push -u origin claude/keen-edison-2dosax`.
3. O Render (`render.yaml`, `autoDeploy: true`) faz o deploy sozinho a cada push nessa branch.
4. Conferir `https://imobflow-d0r2.onrender.com/api/health` (deve responder `{"ok":true,...}`; o plano gratuito pode levar ~1 min para acordar) e informar o resultado.

Limites: não abrir PR nem mexer em outra branch sem pedido; nunca versionar segredos (`DATABASE_URL`, senhas, `.env`); não rodar SQL destrutivo no Neon `production` sem confirmação.

## Banco
Neon, projeto `square-truth-49115411`. Migrações em `server/src/db/migrations` rodam na subida da API. Testes usam `TEST_DATABASE_URL` (banco "test", nunca produção). Detalhes em `docs/DEPLOY.md`.
