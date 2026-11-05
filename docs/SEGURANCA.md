# Revisão de segurança (autorrevisão — não é auditoria independente)

## Controles verificados por teste
- Isolamento entre organizações em todas as rotas (pessoas, imóveis, negócios, agenda, arquivos, contratos, contatos).
- Permissões por papel no servidor; documentos, CPF/CNPJ e observações privadas protegidos.
- Upload: tipo detectado pelo conteúdo, limite de tamanho, nome do usuário nunca vira caminho, download autenticado com `nosniff`.
- Página pública: conteúdo escapado, sem dados internos; fotos só se marcadas como públicas; despublicar remove acesso.
- Formulário público: honeypot, token assinado com tempo, limite por IP, deduplicação.
- CSRF: cookie SameSite=lax + checagem de Origin nas mutações (localhost só fora de produção).
- Cabeçalhos: CSP (frame-ancestors none), HSTS, nosniff (Helmet).
- Produção: a API não sobe sem FORM_SECRET forte, HTTPS, cookie seguro e sem DEV_EXPOSE_TOKENS.
- Agenda por URL: token aleatório, só hash no banco, rotacionável e revogável.
- `npm audit --omit=dev`: 0 vulnerabilidades (04/11/2026).

## Riscos conhecidos / decisões
- CSP usa `'unsafe-inline'` por causa do script/estilo da página pública (conteúdo escapado). Melhoria futura: nonces.
- Sem 2FA, sem bloqueio progressivo de login além do rate limit, sem reautenticação para ações sensíveis.
- Arquivos não passam por antivírus; tipo validado pelo conteúdo.
- Atrás de proxy é preciso `TRUST_PROXY=true`, senão os limites por IP valem para todos juntos.
- Backup: script pronto (`scripts/backup.sh`); restauração não testada em ambiente real.
- Sem teste de invasão nem revisão jurídica (LGPD). Textos de consentimento são modelos.
