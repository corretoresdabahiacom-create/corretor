# Lacunas em relação ao prompt original e ideias de outros sites

## Do prompt original — ainda não feito
- **Mídia:** upload de arquivo de vídeo (hoje só por link do YouTube/Vimeo), barra de progresso no upload, reordenar fotos, substituir arquivo, arquivos ligados a negócios.
- **Google:** integração com Google Drive (optou-se por S3/R2) e Google Calendar com OAuth (hoje: assinatura iCal somente leitura); página institucional do produto e guia de incorporação no Google Sites (a vitrine pode ser usada por link).
- **Contratos:** renovação, registro manual de pagamentos e pendências, histórico de reajustes, garantidores, vistorias, calendário de disponibilidade de temporada.
- **Litoral:** origem da distância da praia, preço por período, regras de temporada.
- **Pessoas/negócios:** compartilhar um imóvel ou oportunidade com um colaborador específico; ~~solicitação de visita no formulário público~~ (feito: data e período opcionais na página do imóvel; o corretor vê em "Contatos novos").
- **LGPD:** política de retenção/exclusão, exportação dos dados do titular, procedimento documentado de incidentes. (Revisão jurídica pendente.)
- **Relatórios:** contratos próximos do vencimento como relatório próprio (hoje aparecem como alertas).
- **Painel:** conferir tarefas atrasadas.

## Já cobrido nesta rodada
Vitrine por categorias, marca (logo/cores/slogan), QR Code, cartão de visita 90×50 mm em 3 layouts, destaque de imóveis, miniaturas de fotos, contagem de acessos por origem (link, QR, cartão).

## Ideias vistas em sites imobiliários que cabem aqui (a priorizar)
1. Planta do imóvel e mapa incorporado na página pública (vídeo por link já existe).
2. Mapa com pins na vitrine (OpenStreetMap, gratuito).
3. Alertas de novos imóveis para o interessado (exige e-mail; consentimento).
4. Simulador de financiamento (apenas estimativa, com aviso).
5. Comparador e favoritos para o visitante (sem login, guardados no aparelho).
6. Agendamento de visita direto na página pública.
7. ~~Avaliação pedida pelo proprietário~~ (feito: formulário no site).
8. ~~Cartão digital com link para salvar contato (vCard) no celular~~ (feito: botão "Salvar contato" na vitrine, `/v/<slug>/contato.vcf`).
9. Modelo de mensagem pronta de WhatsApp por tipo de imóvel.


## Atualização (fases 11–14)
Feitos: parcelas/pagamentos/reajuste/renovação de contratos; mapa na vitrine e na página do imóvel; exportação/anonimização/retenção (LGPD, com docs/LGPD.md); vídeo enviado como arquivo.
Continuam pendentes: boleto/PIX/cobrança automática e conciliação bancária; índices oficiais (IGP-M/IPCA) automáticos; conversão de vídeo; 2FA; deploy no Cloudflare Pages e Firebase (dependem de contas/credenciais do dono); teste em aparelhos reais (iPhone/Android), leitor de tela e rede lenta.
