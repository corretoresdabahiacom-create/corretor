# ImobFlow (nome provisório) — MVP de gestão imobiliária

SaaS multi-organização para imobiliárias e corretores: pessoas, imóveis (urbano, rural, litoral), funil, agenda e relatórios.
Veja `docs/PLANO.md` (fases, decisões, acréscimos) e `docs/STATUS.md` (o que está pronto, parcial e pendente).

## Rodar localmente
```bash
cp .env.example .env            # ajuste a senha do banco
npm install
npm run migrate                 # cria/atualiza o schema (PostgreSQL 16)
npm run seed:demo               # opcional: dados FICTÍCIOS, org separada (demo@imobflow.local / demo-senha-123)
npm run dev:server              # API em :3001
npm run dev:web                 # app em :5173 (proxy /api)
npm test                        # 20 testes de fluxo no banco imobflow_test
```
Requer PostgreSQL 16 com extensões `pgcrypto` e `pg_trgm`.

## Segurança (resumo)
Senhas argon2id; sessão opaca em cookie httpOnly; permissões por papel validadas no servidor; toda consulta filtrada por organização;
CPF/CNPJ e observações privadas mascarados por permissão; rate limit em login/cadastro/recuperação; exportação CSV protegida contra injeção de fórmula; trilha de auditoria.
Não há segredos no código. Este projeto **não afirma conformidade legal** (LGPD etc.); isso exige revisão jurídica.

## Backup e restauração
```bash
pg_dump -Fc -h HOST -U imobflow imobflow > backup-$(date +%F).dump
pg_restore -c -d imobflow backup.dump        # teste a restauração periodicamente
```
Deploy: ver docs/DEPLOY.md
