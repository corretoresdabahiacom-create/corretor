# Lacunas em relação ao prompt original e ideias de outros sites

## Do prompt original — ainda não feito
- **Mídia:** ~~upload de arquivo de vídeo~~ (feito na fase 14), barra de progresso no upload, reordenar fotos, substituir arquivo, arquivos ligados a negócios.
- **Google:** integração com Google Drive (optou-se por S3/R2) e Google Calendar com OAuth (hoje: assinatura iCal somente leitura); página institucional do produto e guia de incorporação no Google Sites (a vitrine pode ser usada por link).
- **Contratos:** ~~renovação, registro manual de pagamentos e pendências, histórico de reajustes~~ (feitos na fase 11; multa/juros na 15), garantidores, vistorias, calendário de disponibilidade de temporada.
- **Litoral:** origem da distância da praia, preço por período, regras de temporada.
- **Pessoas/negócios:** compartilhar um imóvel ou oportunidade com um colaborador específico; ~~solicitação de visita no formulário público~~ (feito: data e período opcionais na página do imóvel; o corretor vê em "Contatos novos").
- **LGPD:** ~~exportação dos dados do titular, anonimização, limpeza de contatos antigos, procedimento de incidentes~~ (feitos na fase 13, `docs/LGPD.md`); retenção automática. (Revisão jurídica pendente.)
- **Relatórios:** contratos próximos do vencimento como relatório próprio (hoje aparecem como alertas).
- **Painel:** conferir tarefas atrasadas.

## Já cobrido nesta rodada
Vitrine por categorias, marca (logo/cores/slogan), QR Code, cartão de visita 90×50 mm em 3 layouts, destaque de imóveis, miniaturas de fotos, contagem de acessos por origem (link, QR, cartão).

## Ideias vistas em sites imobiliários que cabem aqui (a priorizar)
1. Planta do imóvel na página pública (~~mapa incorporado~~ feito na fase 12).
2. ~~Mapa com pins na vitrine (OpenStreetMap, gratuito)~~ (feito na fase 12).
3. Alertas de novos imóveis para o interessado (exige e-mail; consentimento).
4. ~~Simulador de financiamento (apenas estimativa, com aviso)~~ (feito na fase 17, página do imóvel à venda).
5. Comparador e favoritos para o visitante (sem login, guardados no aparelho).
6. Agendamento de visita direto na página pública.
7. ~~Avaliação pedida pelo proprietário~~ (feito: formulário no site).
8. ~~Cartão digital com link para salvar contato (vCard) no celular~~ (feito: botão "Salvar contato" na vitrine, `/v/<slug>/contato.vcf`).
9. Modelo de mensagem pronta de WhatsApp por tipo de imóvel.


## Atualização (fases 11–14)
Feitos: parcelas/pagamentos/reajuste/renovação de contratos; mapa na vitrine e na página do imóvel; exportação/anonimização/retenção (LGPD, com docs/LGPD.md); vídeo enviado como arquivo.
Continuam pendentes: boleto/PIX/cobrança automática e conciliação bancária; índices oficiais (IGP-M/IPCA) automáticos; conversão de vídeo; 2FA; ~~deploy no Cloudflare~~ (no ar via Workers Builds desde 16/11/2026; falta confirmar segredos e o login em produção); Firebase não é usado; teste em aparelhos reais (iPhone/Android), leitor de tela e rede lenta.


## Atualização (fases 18–19)
Feitos: reajuste com busca automática de IGP-M/IPCA/INPC/IGP-DI (sugestão; chamada real ao BCB ainda não testada); 10 modelos de contrato com histórico na pasta do cliente (editar, copiar, excluir, compartilhar); aviso semanal de mudança nas fontes dos modelos.
Continuam pendentes: conversão de vídeo, reordenar fotos, barra de progresso, Google Drive/Calendar, garantidores, vistorias, calendário de temporada, alertas de novos imóveis, comparador/favoritos, agendamento de visita, mensagem pronta de WhatsApp (próximas fases).
