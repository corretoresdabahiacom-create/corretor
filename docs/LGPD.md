# Privacidade e LGPD — o que o sistema faz e o que falta

> Este documento descreve **ferramentas e procedimentos operacionais**. Não é parecer jurídico, não garante conformidade com a Lei 13.709/2018 e **precisa de revisão por advogado** antes de ser adotado como política.

## O que o sistema oferece
| Necessidade | Como fazer | Observações |
|---|---|---|
| Cópia dos dados de um titular | Pessoas → abrir cadastro → **Exportar dados (LGPD)** (admin e gestor) | JSON com cadastro, interações, negócios, propostas, reservas, tarefas, eventos, lista de arquivos, contratos e contatos recebidos pelo site. Não inclui o conteúdo dos arquivos. Fica registrado na auditoria. |
| Apagar/anonimizar um titular | Pessoas → cadastro → **Anonimizar…** (somente admin) | Irreversível. Remove nome, documento, telefones, e-mails, endereço, observações, interações, documentos e contatos do site ligados à pessoa. Mantém negócios e contratos sem identificá-la. **Bloqueia** se houver contrato ativo. |
| Retenção de contatos do site | Minha conta → Privacidade → **Apagar contatos antigos** (admin, mínimo 30 dias) | Apaga contatos recebidos pelo site que não viraram cliente. Não é automático: alguém precisa executar (sugestão: trimestral). |
| Consentimento no site | Formulários públicos exigem marcar a autorização; o texto aceito fica gravado junto com o contato | Revise o texto (`CONSENT_TEXT`) com seu advogado. |
| Acesso mínimo | Papéis admin/gestor/corretor/assistente/consulta; CPF/CNPJ e observações privadas só para quem tem permissão | Verificado no servidor. |
| Rastreabilidade | Auditoria de exportações, anonimizações, exclusão de conta e limpezas | A auditoria não guarda dados pessoais do titular. |
| Exclusão da conta | Minha conta → Excluir (admin apaga a imobiliária inteira) | Apaga em cascata dados, arquivos, site e cartão. |

## Limites conhecidos (não esconda do cliente)
- Textos livres (tarefas, eventos, negócios, propostas, observações de contratos) **não são reescritos** na anonimização: revise se citam o nome da pessoa.
- **Backups** (Neon: histórico de restauração limitado; backups feitos por você com `scripts/backup.sh`) mantêm os dados até expirarem.
- Não há exportação em lote nem portabilidade em formato padronizado além do JSON.
- Não há controle de bases legais por finalidade, nem registro formal de operações (ROPA), nem DPO designado: são decisões da imobiliária.
- Logs de acesso do provedor de hospedagem (Render/Cloudflare) seguem as políticas desses provedores.
- O mapa usa tiles do OpenStreetMap e o endereço digitado em "Localizar pelo endereço" é enviado ao Nominatim (OpenStreetMap). Nenhum dado de pessoas é enviado.

## Procedimento sugerido para pedidos de titulares (rascunho)
1. Confirme a identidade do solicitante por um canal já conhecido (não aceite só um e-mail novo).
2. Registre o pedido (data, tipo: acesso, correção, eliminação, portabilidade).
3. Acesso/portabilidade: use **Exportar dados** e envie por canal seguro (não por mensagem aberta).
4. Eliminação: verifique obrigações de guarda (contratos, fiscais). Se não houver impedimento, **Anonimizar**; se houver contrato ativo, encerre antes.
5. Responda dentro do prazo definido pela lei e guarde a evidência (a auditoria já registra a execução).

## Procedimento sugerido para incidentes de segurança (rascunho)
1. **Conter:** troque a senha dos usuários afetados (o sistema encerra sessões ao trocar a senha), revogue acessos, rotacione `DATABASE_URL`/senha do banco no Neon e `FORM_SECRET` no Render.
2. **Avaliar:** consulte o log de auditoria (admin) e os logs do Render/Neon: quais dados, quantos titulares, desde quando.
3. **Registrar:** data/hora, descrição, dados envolvidos, medidas tomadas.
4. **Comunicar:** com seu advogado, decida se há risco relevante aos titulares e se é preciso avisar a ANPD e os titulares dentro do prazo legal.
5. **Corrigir e aprender:** corrija a causa, atualize este documento e `docs/SEGURANCA.md`.

## Retenção sugerida (a validar juridicamente)
| Dado | Sugestão inicial |
|---|---|
| Contatos do site não convertidos | 12 meses |
| Cadastro de cliente sem negócio ativo | revisar anualmente |
| Contratos e comprovantes | prazo legal/contábil aplicável |
| Backups | conforme política do provedor; documente |
