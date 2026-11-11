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
- Alerta "pagamento em atraso" em Contratos e resumo de recebimentos do mês. **Não** emite boleto, não cobra, não concilia banco, não calcula juros/multa.
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
