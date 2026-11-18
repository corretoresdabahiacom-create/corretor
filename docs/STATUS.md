# Status (honesto)

## Concluído (Fase 1)
Backend completo e testado; frontend mobile-first com todas as telas da Fase 1 (login/cadastro, painel, pessoas, imóveis, funil, agenda, relatórios, equipe).

## Concluído (Fase 2)
Fotos (galeria, capa, legenda) e documentos privados em imóveis, pessoas e contratos; upload validado pelo conteúdo real (JPG/PNG/WebP/PDF), limite 10 MB, 40 fotos por imóvel, nomes sanitizados, download só com login e permissão; documentos nunca públicos. Contratos de locação e arrendamento rural (rascunho → ativo → encerrado/rescindido), bloqueio de sobreposição por imóvel, status do imóvel atualizado, alertas de vencimento (30/60/90 dias), vencidos ainda ativos e reajuste, exibidos no painel.

## Concluído (Fase 3)
Publicação de imóveis (exige autorização do proprietário e status disponível) em página pública `/p/:código` com metadados Open Graph/JSON-LD (prévia no WhatsApp), só com fotos marcadas como públicas; sem notas internas, proprietário, documentos, registro rural nem endereço exato (a menos que autorizado); preço pode ser ocultado. Formulário de contato com consentimento, honeypot, token assinado com tempo mínimo, limite por IP, deduplicação em 24h e Turnstile opcional. Caixa de contatos com conversão em cliente. Compartilhamento (WhatsApp por link `wa.me`, copiar link) com contagem. Plano gratuito com limites (15 imóveis, 5 publicados, 3 usuários+convites) e selo "Feito com ImobFlow" com link de indicação; contagem de imobiliárias indicadas; métricas de 30 dias.

## Concluído (Fase 4)
Agenda por URL (iCalendar privado, rotacionável, escopo por usuário) para Google Agenda/Apple/Outlook; e-mail transacional (convite e recuperação de senha) via Resend ou modo console, sem revelar se a conta existe; PWA instalável; robots.txt e sitemap.xml; app web servido pela própria API em produção; validação de configuração insegura na inicialização; CSP/HSTS; Origin estrito em produção; `trustProxy`; script de backup; workflows de CI e deploy; dependências sem vulnerabilidades conhecidas. Ver `docs/SEGURANCA.md` e `docs/DEPLOY.md`.

## Concluído (Fase 5 — vitrine)
Vitrine pública `/v/:slug` com imóveis publicados e disponíveis agrupados em Destaques, Venda, Aluguel, Litoral e Rural/arrendamento, com fotos públicas (miniaturas WebP), descrição, preço (se autorizado), busca e botão de WhatsApp. Marca por imobiliária (logomarca reprocessada em PNG — SVG recusado —, cores, slogan, layout). QR Code (SVG) e cartão de visita individual 90×50 mm, 300 dpi, em 3 layouts (PNG para baixar/imprimir). Acessos contados por origem. Ver `docs/LACUNAS.md` para o que falta.

## Verificação
- `npm test` (servidor): **40/40 passaram** (4 novos da Fase 5: vitrine/privacidade, miniaturas/QR/sitemap, marca/logo, cartão; 20 da Fase 1 + 3 da Fase 2 + 5 da Fase 3 + 6 da Fase 4 [agenda iCal, e-mail, SEO, cabeçalhos/CSRF, config de produção, PWA]; Fase 3: [vazamento de dados, formulário anti-spam, conversão, limites do plano, indicação]: upload/permissões/isolamento, capa/exclusão/limite, ciclo de contratos e alertas) (validadores, auth/convites/reset, duplicidade, filtros, funil, reservas, agenda, papéis, isolamento entre organizações, relatórios/CSV).
- Frontend: `tsc` e `vite build` **passaram**.

## Parcial / limitações conhecidas
- E-mail não integrado: convites e recuperação de senha só funcionam por link exibido (DEV_EXPOSE_TOKENS). Lembretes só dentro do app.
- Sem backup automatizado, sem monitoramento.

## Pendente / fora do escopo atual
Sync Google Agenda com escrita (OAuth); plano pago e cobrança; integração com portais imobiliários e WhatsApp Business; rede de parceiros; 2FA; antivírus de uploads; miniaturas de imagens; revisão jurídica (LGPD/contratos); teste de carga e testes de interface (E2E).

**Situação:** as 4 fases do plano estão implementadas e os fluxos principais passam nos testes automatizados. Antes de usar com clientes reais: publicar em ambiente de teste, validar manualmente no celular, testar backup/restauração e fazer revisão jurídica.

## Cartão (somente frente) e avaliação de imóveis
- Cartão: só a frente (logo, nome da imobiliária ou do corretor à escolha, serviços em coluna, QR). Serviços editáveis (1–5) na marca.
- Vitrine: faixa "Nossos serviços" e formulário público de pedido de avaliação (token, honeypot, consentimento, limite por IP) que cai na caixa de contatos.
- Testado: API (40/40). Não testado: impressão em gráfica, leitura do QR em celular real, fontes em produção.

## Cartão personalizável
- Serviços padrão: "Vendas, aluguel e arrendamentos", "Imóveis urbanos, rurais e litorais", "Avaliação de imóveis" (editáveis).
- Botão "Clique aqui" (texto editável) + QR levam à vitrine; no app o cartão é clicável e o SVG baixado tem o link. PNG/impresso não clica (use o QR).
- Admin edita fundo, texto, cor do botão, nome em destaque, linha abaixo, título dos serviços, botão e contatos. Testes: 41/41 (na época).

## Fase 6 — layout moderno, PWA e site da imobiliária
- **App:** novo design (tokens, cartões, tipografia), menu lateral agrupado no computador, barra de 5 itens + "Mais" no celular, busca que abre no topo, indicadores com valor curto (R$ 1,49 mi), tabelas que viram cartões no celular, login com painel.
- **Telas corrigidas:** barra inferior com 10 ícones cortados; busca espremida; vitrine estreita no computador; tabelas espremidas; botão estourando na tela Equipe.
- **PWA:** manifesto completo (ícones "any" e "maskable", atalhos), ícone para iPhone, botão "Instalar o app" (e instrução no iPhone), aviso "Nova versão disponível", tela sem internet (no app e `offline.html`), service worker que nunca guarda `/api`, `/p` nem `/v`, cabeçalhos de cache corretos (`sw.js` e `index.html` sem cache; `assets/` imutáveis).
- **Site da vitrine (`/v/:slug`):** capa com fotos que trocam, busca rápida, categorias, destaques, todos os imóveis com filtros (finalidade, tipo, cidade, região, preço mín./máx., quartos, vagas, área, palavra-chave, ordenação) por link compartilhável, serviços, sobre nós, vídeos, galeria, avaliação, contato, botão flutuante de WhatsApp.
- **Página do imóvel no site (`/v/:slug/imovel/:código`):** galeria (com tela cheia), dados principais, descrição, características, vídeos, região no mapa (link), contato e WhatsApp, imóveis parecidos. Só mostra imóveis da própria imobiliária.
- **Editor (Site e cartão → Site):** cores de fundo/texto (com sugestões), topo, capa, lista em grade ou lista, letras, cantos; título e frase da capa; fotos (enviar/excluir/escolher, até 60, sem GPS); seções liga/desliga e ordem; sobre nós; vídeos por link; galeria com legendas; contato, redes e rodapé; pré-visualização ao vivo em celular e computador.
- **Vídeos dos imóveis:** por link do YouTube (modo sem cookies) ou Vimeo, até 10 por imóvel.
- **Erros encontrados e corrigidos na auditoria:** script da vitrine antiga com `;` faltando (busca e avaliação não funcionavam no navegador); recarga automática na 1ª visita apagava o que a pessoa digitava; filtros do site não abriam no celular; após novo build, arquivos JS novos caíam na página HTML.
- **Testes:** 46/46 (inclui: links de vídeo aceitos/recusados, filtros, edição do site, permissões, imagens de outra imobiliária recusadas, isolamento da página do imóvel, scripts das páginas públicas compilam, regras do service worker).
- **Não testado:** instalação real em Android/iPhone, vídeos tocando (rede do ambiente bloqueia YouTube/Vimeo), leitores de tela, desempenho em 3G, imagens no R2.
- **Observação:** a página pública tem cache de 60 s; uma alteração salva no editor pode levar até 1 minuto para aparecer para visitantes (a pré-visualização é imediata).

## Fase 7 — visual do site no app e aparência editável
- **App no computador com o visual do site:** Início com capa (foto ou cor), saudação, busca rápida de imóveis e atalhos; indicadores destacados; imóveis em cartões com foto, selos, preço, endereço e ícones (quartos, banheiros, vagas, área), em grade ou lista (cada pessoa pode alternar).
- **Aparência do app (Gestão → Aparência do app, só administrador):** "Igual ao site" (acompanha o site automaticamente) ou "Visual próprio"; cor principal, de destaque, fundo e texto (com sugestões); menu lateral claro, escuro ou na cor principal; letras moderna/clássica/elegante; cantos; grade ou lista; foto da capa do Início (mesmas fotos do site). Pré-visualização ao vivo no app inteiro, "Desfazer" e "Salvar para a equipe".
- **Servidor:** `organizations.app_theme`; `GET/PATCH /api/app-theme` (org.manage, cores validadas, foto só da própria imobiliária); tema efetivo entregue em `/api/auth/me`; capa do imóvel na listagem; miniatura autenticada `/api/files/:id/thumb`.
- **Testes:** 49/49 (tema aplicado à equipe, isolamento entre imobiliárias, permissões, "igual ao site", miniaturas).
- **Não testado:** contraste de todas as combinações de cores escolhidas livremente (o app escolhe a cor do texto dos botões automaticamente, mas cores muito parecidas de fundo e texto podem ficar ilegíveis).


## Fase 9 — arquivos persistentes e deploy verificado
- `STORAGE_DRIVER=db`: arquivos no Postgres (migração 011, RLS, exclusão em cascata). Testes: upload/download/isolamento/chave inválida/cascata (`phase9.test.ts`, 2 testes).
- `/api/health` devolve o `commit` em produção; `deploy-check.yml` confirma que a versão enviada foi ao ar.
- Suíte: 56 testes passando localmente (Postgres 16). Não testado: o serviço real no Render (o ambiente de desenvolvimento não alcança *.onrender.com) — a conferência fica a cargo do workflow.

## Fase 10 — visita e contato
- Página pública do imóvel: campos opcionais de data (hoje até 90 dias) e período; validação no servidor; aparece como "Pediu visita" em Contatos novos. Visita não é agendamento automático: o corretor confirma por contato.
- Vitrine: `/v/<slug>/contato.vcf` (vCard 3.0, escapando `\ ; ,`) e botão "Salvar contato" quando há telefone, WhatsApp ou e-mail.
- Testes: `phase10.test.ts` (5). Suíte: 61 passando. Não testado: importar o .vcf em iPhone/Android reais.

## Fase 11 — financeiro dos contratos (parcelas, reajuste, renovação)
- Migração 012: `contract_payments`, `contract_adjustments`, `contracts.renewed_from` (RLS ligado).
- Parcelas geradas pelo prazo (mensal no dia de vencimento, ajustado ao fim do mês; anual por aniversário; safra uma parcela no fim), sem duplicar; cobranças avulsas; baixa total/parcial com data (nunca futura) e forma; desfazer; status pago/parcial/atrasado/pendente calculado na data de Brasília.
- Reajuste: percentual informado por quem opera (o app **não** busca índices oficiais); atualiza o contrato e só as parcelas ainda não pagas a partir da vigência; histórico.
- Renovação: encerra o atual como "Renovado", cria o novo já ativo ligado ao anterior (início = fim do anterior), gera as parcelas e mantém o imóvel ocupado.
- Alerta "pagamento em atraso" em Contratos e resumo de recebimentos do mês. **Não** emite boleto, não cobra, não concilia banco, o valor da parcela não muda.
- Testes: `phase11.test.ts` (calendário, parcelas, permissões, isolamento, reajuste, renovação).

## Fase 12 — mapa
- Leaflet servido pelo próprio app (`/vendor/leaflet.*`), tiles do OpenStreetMap (CSP liberada só para `tile.openstreetmap.org`).
- Página do imóvel e seção "Mapa dos imóveis" da vitrine (editável/ocultável como as demais). Com "mostrar localização exata" o ponto é exato; sem ele, só um círculo de região (coordenadas arredondadas a ~1 km — a coordenada real não vai para o HTML).
- "Localizar pelo endereço" no cadastro do imóvel (Nominatim/OpenStreetMap, 1 consulta/s, com cache). Testes com o serviço simulado; **a consulta real ao Nominatim e o carregamento real dos tiles não foram testados aqui** (o ambiente não acessa esses domínios). Uso dos tiles públicos do OSM é para tráfego baixo; para volume alto, trocar de provedor.
- Testes: `phase12.test.ts` (7). Conferido em navegador: pino exato e círculos aparecem, sem erros de script.

## Fase 13 — LGPD (ferramentas)
- Exportar dados do titular (JSON, admin/gestor), anonimizar (admin, irreversível, bloqueia com contrato ativo), apagar contatos antigos do site (mín. 30 dias). Tudo auditado sem dados pessoais. Documento: `docs/LGPD.md` (limites, procedimentos sugeridos e **necessidade de revisão jurídica**). Não declara conformidade.
- Testes: `phase13.test.ts` (6).

## Fase 14 — vídeo enviado como arquivo
- MP4 (H.264) ou WebM até 30 MB (`MAX_VIDEO_MB`), 3 por imóvel e 150 MB por imobiliária (`MAX_ORG_VIDEO_MB`); tipo conferido pelo conteúdo; entrega com Range (206/416) para tocar e avançar; público só se marcado e com o imóvel publicado; exibido na página do imóvel.
- **Não há conversão/compressão**: se o codec não for compatível com o navegador, o vídeo não toca. No Postgres/Neon free o espaço é pequeno (~0,5 GB no total): vídeos longos devem ir por link YouTube/Vimeo.
- Testes: `phase14.test.ts` (7) + leitura de trecho no driver de banco. Não testado: reprodução em aparelhos reais.

Suíte total: 87 testes passando (Postgres 16 local), typecheck e build ok.

## Fase 15 — Multa e juros por atraso
- Migração 014: `late_fee_pct` (padrão 2%) e `late_interest_pct_month` (padrão 1% a.m.) por contrato. `PATCH /api/contracts/:id/late-fees` (contracts.write; multa 0–20, juros 0–10).
- A lista de parcelas traz `encargos` (multa única + juros simples pro rata dia sobre o saldo) para parcelas atrasadas; é estimativa para cobrança à parte, não altera o valor da parcela nem baixa automaticamente. Confirme com contrato/advogado os percentuais permitidos.
- Teste: phase11 (cálculo, configuração, validação). Total: 88 testes.

## Fase 16 — Deploy no Cloudflare Workers (sem Render)
- Camada HTTP própria (`server/src/http/*`, compatível com a API do Fastify usada), baseada em Request/Response: roda em Node e no Worker. Fastify e plugins removidos. Os 88 testes passam sobre ela.
- Worker único (`server/src/worker.ts`, `wrangler.jsonc`): API + páginas públicas + app web (Workers Assets). Pool de banco por requisição. Testado localmente com `wrangler dev`: cadastro, login, sessão, criação de pessoa, upload de imagem, vitrine e cabeçalhos de segurança.
- Senhas: PBKDF2-SHA512 (WebCrypto); hashes argon2 antigos só funcionam em Node → `npm -w server run reset-password`.
- Imagens: `sharp` em Node; no Worker valida/limpa EXIF e o navegador reduz as fotos antes do envio.
- Render, Pages Functions e os workflows antigos removidos. Publicação: Cloudflare Workers Builds (painel) a cada push em `main`; `deploy-cloudflare.yml` ficou como alternativa manual (fase 17).
- Deploy feito em 16/11/2026 pelo painel (build `npm run build`, deploy `npx wrangler deploy`).

## Fase 17 — auditoria pós-Cloudflare e simulador de financiamento
**Erros e contradições corrigidos**
- Caches de imagem limitados só por quantidade: no Worker (sem `sharp`) guardavam fotos originais e podiam estourar os 128 MB do isolate → cache limitado por **bytes** (`lib/byteCache.ts`, 12 MB cada no Worker).
- App web servido pelos Workers Assets **sem** cabeçalhos de segurança (CSP, X-Frame-Options, HSTS) → mesma política da API em `web/public/_headers`, com teste que impede divergência.
- `PUBLIC_ORIGIN` com barra no final bloqueava todas as alterações ("Origem não permitida") → normalizado; Origin igual ao próprio host também é aceito.
- O build do painel (`npm run build`) **não migrava** o banco e a doc dizia que sim → o Worker aplica as migrações pendentes sozinho (embutidas no bundle, trava transacional contra execução dupla, testado com banco vazio no `wrangler dev`).
- Segredo faltando gerava "Error 1101" genérico → 503 explicando **quais** variáveis faltam (só nomes), no app, na vitrine e no `/api/health`; mensagens de configuração mais claras.
- Conta com senha argon2 via "senha incorreta" para sempre no Worker → mensagem específica (`senha_legada`); em Node a senha é regravada no formato novo no login. Login de e-mail inexistente agora custa o mesmo tempo (não revela quem tem conta).
- Servidor de estáticos (Node) aceitava `/..%2fdist2/...` (pasta vizinha com o mesmo prefixo) → corrigido; URL malformada dá 400.
- Erro após `setCookie` mantinha o cookie na resposta de erro → descartado.
- Workflow do GitHub e Workers Builds publicariam em dobro (e `--var PUBLIC_ORIGIN` conflitaria com o segredo de mesmo nome) → workflow só manual, `PUBLIC_ORIGIN` como segredo.
- `/api/health` passou a conferir o banco (`db: ok|erro|lento`, 503 se falhar).
- Docs desatualizados (Render, Helmet, argon2, `frame-ancestors none`, contagem de testes, itens já feitos em LACUNAS) corrigidos; flag `enable_nodejs_http_server_modules` e script `cf:build` sem uso removidos.

**Inovação: simulador de financiamento** na página pública do imóvel à venda (com preço visível): entrada (20% sugerido), prazo, juros, SAC ou Price; mostra valor financiado, parcelas, total e renda sugerida (30%); avisa entrada abaixo de 20%; botão "Quero ajuda com o financiamento" preenche o formulário de contato. Só estimativa (sem seguros, tarifas e TR), calculada no navegador; nada é enviado sem a pessoa pedir contato.

**Trocar senha (logado):** Minha conta → Trocar senha (`POST /api/auth/password`): pede a atual, valida a nova, mantém a sessão atual e desconecta os outros aparelhos; auditado. Antes só existia "esqueci minha senha" (que depende de e-mail configurado).

**Verificação:** 107 testes (novos: `worker.test.ts` 15, `simulator.test.ts` 4), typecheck, build, bundle do Worker; no `wrangler dev`: página de configuração incompleta, migração automática num banco vazio, cadastro/login e mensagem de senha antiga; simulador conferido no Chromium (celular).
**Não testado:** o Worker real na Cloudflare (o ambiente daqui não alcança workers.dev), CPU real do login no plano gratuito, Neon acessado de dentro da Cloudflare.


## Fase 18 — reajuste automático por índice oficial (IGP-M, IPCA, INPC, IGP-DI)
- Migração 015: `economic_indices` (variação mensal) e `economic_indices_sync`. Fonte: API pública de séries do **Banco Central (SGS)**: IGP-M 189, IPCA 433, INPC 188, IGP-DI 190 (sem chave, gratuita).
- `GET /api/contracts/:id/adjust-suggestion?effective_date=&index=`: acumulado **composto de 12 meses** que terminam no mês anterior à vigência. Atualiza sozinho quando os dados têm mais de 12 h (tentativa nova só a cada 15 min). BCB fora do ar → usa o que está guardado e avisa (`stale`, `error`). Falta algum mês (ainda não divulgado) → `complete=false` e lista os meses: a tela mostra aviso e **não preenche** o percentual.
- `POST /api/indices/refresh` atualiza as quatro séries na hora. A tela "Reajustar valor" ganhou "Buscar índice oficial" (índice do contrato ou outro à escolha). É **sugestão**: quem opera confere o contrato (mês-base, teto) e confirma.
- Testes: `phase18.test.ts` (8, com o BCB simulado). **Não testado:** chamada real ao `api.bcb.gov.br` (o ambiente de desenvolvimento não alcança o domínio); a primeira busca real acontece em produção.

## Fase 19 — modelos de contrato e histórico na pasta do cliente
- 10 modelos em `server/src/lib/docTemplates.ts` (texto próprio, simples, na estrutura de cláusulas dos modelos dos Conselhos): corretagem de **venda**, **locação** e **arrendamento** (todas com **autorização escrita para anunciar em sites e redes sociais**, exclusividade opcional, comissão, proteção pós-prazo, LGPD), locação **residencial** (garantia: fiador, caução, seguro, título ou nenhuma), **comercial** e **temporada**, **compra e venda** (à vista, parcelado ou financiado, arras), **recibo de sinal**, **arrendamento rural** e **avaliação** (PTAM). Valores e datas por extenso.
- Fontes consultadas em 18/11/2026: CRECI-PB (catálogo mais completo) e kit do CRECI-MS. Nenhum conselho publica modelo de avaliação: foi escrito com base no PTAM. Os modelos **não substituem** advogado nem o modelo oficial do CRECI da região (aviso na tela e em cada modelo).
- Migração 016: `contract_docs`, `contract_doc_versions`, `contract_doc_shares` (RLS ligado). Permissão nova `docs.contracts`: **administrador, gestor e corretor** (assistente e consulta não veem nada). Na ficha do cliente: criar de um modelo (preenche cliente, imóvel, corretor, CRECI do cartão, imobiliária), **editar** texto e campos, situação (rascunho → finalizado → assinado; só rascunho é editável), **histórico de versões** com restaurar (últimas 30), **copiar** (mesmo ou outro cliente), **excluir** e **compartilhar** por link com validade de 1 a 30 dias (só o hash fica no banco, cancelável, conta visualizações, `noindex`) e botão imprimir/salvar PDF. Anonimizar a pessoa apaga os contratos dela; a exportação LGPD inclui os documentos.
- **Aviso de atualização dos modelos:** tarefa agendada semanal (segunda, 9h23 de Brasília) compara as páginas-fonte com `docs/fontes-modelos.json`; se algo mudou, notifica e **pergunta** se deve atualizar. Nada é alterado sem a resposta.
- Testes: `phase19.test.ts` (8) + rota `/d/*` no teste do wrangler. Total: 123.


## Fase 20 — mídia: conversão de vídeo, reordenar fotos, barra de progresso
- **Barra de progresso** em todo envio de arquivo (XHR com `upload.onprogress`), com "n/total" em lotes.
- **Conversão de vídeo no navegador** (`web/src/video.ts`, sem servidor e sem custo): qualquer formato que o navegador abra (ex.: .mov do iPhone) ou vídeo acima de 30 MB é regravado em até 1280 px, bitrate calculado para caber em ~27 MB, saída MP4/H.264 (se o navegador gravar) ou WebM. Leva o tempo do vídeo e a aba precisa ficar aberta; limite de 10 minutos. Testado em Chromium real: 6 s/4,9 MB → 1,2 MB WebM válido. **Não testado:** Safari/iPhone e Firefox (dependem do `MediaRecorder` de cada um; sem suporte, a tela explica e pede MP4/WebM).
- **Reordenar fotos:** botões ◀ ▶ na galeria; `PUT /api/properties/:id/files/order` (permissão `properties.write`, valida que as fotos são do imóvel). A página pública já ordena por capa e posição.
- Testes: `phase20.test.ts` (2).

## Fase 21 — garantidores, vistorias e calendário de temporada
- **Garantias do contrato** (`routes/contractExtras.ts`, painel "Garantias" no contrato): fiador, avalista, caução, seguro-fiança, título de capitalização, outra. Na locação só uma modalidade de garantia por vez (Lei do Inquilinato, art. 37; fiador+avalista contam como uma). Seguro/título exigem vencimento e geram **alerta** em `/api/contracts/alerts` (60 dias antes, alta urgência com ≤15 dias).
- **Vistorias** de entrada, saída e periódica: roteiro padrão (urbano ou rural), saída pode partir da entrada, rascunho → concluída (trava edição até reabrir), **comparação entrada × saída** (itens que pioraram) e **laudo imprimível** (`/api/inspections/:id/print`, escapa HTML, sem script inline de evento). Fotos: anexar nos arquivos do contrato.
- **Calendário de temporada** (`routes/stays.ts`, painel no imóvel com finalidade "temporada"): reservas, pré-reservas e bloqueios; sobreposição impedida sob trava por imóvel (check-out libera a diária; testado com 3 pedidos simultâneos); **feed iCal** `/ical/<token>.ics` (token secreto, revogável, só datas — sem hóspede nem valores) para Airbnb/Booking/Google Agenda; **datas ocupadas na página pública** (`/api/public/p/:code/availability`).
- Migração `017_guarantors_inspections_stays.sql` (RLS ligado). `/ical/*` entrou em `run_worker_first`.
- **Não feito:** *importar* iCal de Airbnb/Booking (só exporta); pagamento de sinal automático.
- Testes: `phase21.test.ts` (11). Total: 136.
