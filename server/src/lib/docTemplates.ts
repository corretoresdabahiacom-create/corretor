// Modelos de contrato (texto próprio, simples, na estrutura de cláusulas dos modelos publicados pelos Conselhos de Corretores de Imóveis).
// IMPORTANTE: são MODELOS. Não substituem a análise de advogado nem os modelos oficiais do seu CRECI; revise antes de assinar.
// Fontes consultadas em 18/11/2026: CRECI-PB (Canal do Corretor > Modelos de Contratos) e kit do CRECI-MS. Nenhum conselho publica modelo de avaliação:
// o de avaliação foi escrito aqui, com base no Parecer Técnico de Avaliação Mercadológica (PTAM) do sistema COFECI/CRECI.
export type FieldType = 'text' | 'textarea' | 'money' | 'number' | 'date' | 'select';
export interface Field { key: string; label: string; type: FieldType; group: string; options?: [string, string][]; default?: string; hint?: string; required?: boolean }
export type Category = 'corretagem' | 'locacao' | 'venda' | 'arrendamento' | 'avaliacao';
export interface Template { key: string; title: string; category: Category; version: number; summary: string; sides: { a: string; b: string }; fields: Field[]; warnings: string[]; build: (d: Data) => string }
export type Data = Record<string, string | undefined>;

export const SOURCES = [
  { name: 'CRECI-PB — Canal do Corretor > Modelos de Contratos/Documentos', url: 'https://creci-pb.gov.br/canal-do-corretor/modelos-de-contratos/' },
  { name: 'CRECI-MS — Kit do Corretor de Imóveis', url: 'https://crecims.gov.br/docs/modelosdecontratos/kit_do_corretor.pdf' },
];
export const SOURCE_CHECKED = '2026-11-18';

// ---------- formatação ----------
const U = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const T = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const H = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
function ate999(n: number): string {
  if (n === 0) return ''; if (n === 100) return 'cem';
  const c = Math.floor(n / 100), r = n % 100, parts: string[] = [];
  if (c) parts.push(H[c]);
  if (r) parts.push(r < 20 ? U[r] : T[Math.floor(r / 10)] + (r % 10 ? ' e ' + U[r % 10] : ''));
  return parts.join(' e ');
}
export function numeroExtenso(n: number): string {
  if (n === 0) return 'zero';
  const g: [number, string, string][] = [[1e9, 'bilhão', 'bilhões'], [1e6, 'milhão', 'milhões'], [1e3, 'mil', 'mil']];
  const parts: { txt: string; q: number }[] = []; let rest = n;
  for (const [v, sg, pl] of g) { const q = Math.floor(rest / v); if (q) { parts.push({ txt: v === 1e3 && q === 1 ? 'mil' : `${ate999(q)} ${q === 1 ? sg : pl}`, q }); rest %= v; } }
  if (rest) parts.push({ txt: ate999(rest), q: rest });
  // "e" antes da última parte quando ela é menor que 100 ou centena redonda: "mil e um", "um milhão e duzentos mil"
  return parts.map((p, i) => (i > 0 && i === parts.length - 1 && (p.q < 100 || p.q % 100 === 0) ? 'e ' : '') + p.txt).join(' ');
}
export function reaisExtenso(v: number): string {
  const cents = Math.round(v * 100), r = Math.floor(cents / 100), c = cents % 100;
  const reais = r ? `${numeroExtenso(r)} ${r === 1 ? 'real' : (r % 1e6 === 0 ? 'de reais' : 'reais')}` : '';
  const cent = c ? `${numeroExtenso(c)} ${c === 1 ? 'centavo' : 'centavos'}` : '';
  return [reais, cent].filter(Boolean).join(' e ') || 'zero real';
}
const MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export function dataExtenso(iso?: string) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? ''); return m ? `${Number(m[3])} de ${MES[Number(m[2]) - 1]} de ${m[1]}` : '____ de ____________ de ______'; }
const BL = '________________';
function addMonthsISO(iso: string | undefined, n: number) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? ''); if (!m || !Number.isFinite(n)) return undefined;
  const t = new Date(Date.UTC(+m[1], +m[2] - 1 + n, +m[3])); // fim = dia anterior ao aniversário
  t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10);
}
const s = (d: Data, k: string) => (d[k]?.trim() ? d[k]!.trim() : BL);
const has = (d: Data, k: string) => !!d[k]?.trim();
export function money(d: Data, k: string) { const n = Number(d[k]); return Number.isFinite(n) && has(d, k) ? `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${reaisExtenso(n)})` : `R$ ${BL}`; }
const pct = (d: Data, k: string) => { const n = Number(d[k]); return Number.isFinite(n) && has(d, k) ? `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% (${numeroExtenso(Math.trunc(n))}${n % 1 ? ' vírgula ' + String(n.toFixed(2).split('.')[1]).replace(/0+$/, '') : ''} por cento)` : `____%`; };
const dt = (d: Data, k: string) => dataExtenso(d[k]);

function party(d: Data, p: string, papel: string) {
  return `${s(d, p + '_nome').toUpperCase()}, ${has(d, p + '_qualif') ? d[p + '_qualif']!.trim() + ', ' : ''}inscrito(a) no CPF/CNPJ sob o nº ${s(d, p + '_doc')}, residente/sediado(a) em ${s(d, p + '_end')}${has(d, p + '_contato') ? `, contato: ${d[p + '_contato']}` : ''}, doravante denominado(a) ${papel}`;
}
const corretor = (d: Data) => `${s(d, 'corretor_nome').toUpperCase()}, corretor(a) de imóveis inscrito(a) no CRECI sob o nº ${s(d, 'corretor_creci')}${has(d, 'imob_nome') ? `, vinculado(a) à ${d.imob_nome}${has(d, 'imob_cnpj') ? `, CNPJ ${d.imob_cnpj}` : ''}` : ''}, doravante denominado(a) CORRETOR(A)`;
const foro = (d: Data) => `As partes elegem o foro da comarca de ${s(d, 'foro')} para dirimir qualquer dúvida deste contrato, com renúncia a qualquer outro, por mais privilegiado que seja.`;

function compose(titulo: string, preambulo: string, clauses: [string, string][], d: Data, assinaturas: string[], testemunhas = true) {
  const body = clauses.map(([t, x], i) => `CLÁUSULA ${i + 1}ª — ${t.toUpperCase()}\n${x.trim()}`).join('\n\n');
  const sign = assinaturas.map((a) => `\n\n______________________________________\n${a}`).join('');
  const wit = testemunhas ? `\n\nTestemunhas:\n\n1) ______________________________  CPF: ______________\n\n2) ______________________________  CPF: ______________` : '';
  return `${titulo.toUpperCase()}\n\n${preambulo.trim()}\n\n${body}\n\nE, por estarem de acordo, as partes assinam este contrato em 2 (duas) vias de igual teor, na presença das testemunhas.\n\n${s(d, 'cidade')}, ${dt(d, 'data')}.${sign}${wit}\n`;
}

// ---------- campos reutilizáveis ----------
const partyFields = (p: string, label: string, group = label): Field[] => [
  { key: `${p}_nome`, label: `${label}: nome completo / razão social`, type: 'text', group, required: true },
  { key: `${p}_doc`, label: `${label}: CPF / CNPJ`, type: 'text', group, required: true },
  { key: `${p}_qualif`, label: `${label}: nacionalidade, estado civil e profissão`, type: 'text', group, hint: 'Ex.: brasileiro, casado, empresário' },
  { key: `${p}_end`, label: `${label}: endereço completo`, type: 'text', group },
  { key: `${p}_contato`, label: `${label}: telefone / e-mail`, type: 'text', group },
];
const corretorFields: Field[] = [
  { key: 'corretor_nome', label: 'Corretor(a): nome', type: 'text', group: 'Corretor', required: true },
  { key: 'corretor_creci', label: 'Corretor(a): CRECI', type: 'text', group: 'Corretor', required: true },
  { key: 'imob_nome', label: 'Imobiliária (se houver)', type: 'text', group: 'Corretor' },
  { key: 'imob_cnpj', label: 'CNPJ da imobiliária', type: 'text', group: 'Corretor' },
];
const fechamento: Field[] = [
  { key: 'cidade', label: 'Cidade de assinatura', type: 'text', group: 'Fechamento' },
  { key: 'data', label: 'Data de assinatura', type: 'date', group: 'Fechamento' },
  { key: 'foro', label: 'Foro (comarca)', type: 'text', group: 'Fechamento' },
];
const imovelFields: Field[] = [
  { key: 'imovel_desc', label: 'Descrição e endereço do imóvel', type: 'textarea', group: 'Imóvel', required: true },
  { key: 'matricula', label: 'Matrícula nº / cartório de registro', type: 'text', group: 'Imóvel' },
  { key: 'inscricao', label: 'Inscrição municipal (IPTU) / ITR', type: 'text', group: 'Imóvel' },
];
const sn: [string, string][] = [['sim', 'Sim'], ['nao', 'Não']];
const imovelTxt = (d: Data) => `${s(d, 'imovel_desc')}${has(d, 'matricula') ? `, matrícula/cartório: ${d.matricula}` : ''}${has(d, 'inscricao') ? `, inscrição: ${d.inscricao}` : ''}`;

// ---------- corretagem (autorização + prestação de serviço) ----------
type Fin = 'venda' | 'locacao' | 'arrendamento';
const FIN: Record<Fin, { titulo: string; verbo: string; preco: string; precoLabel: string; comLabel: string; comTxt: (d: Data) => string }> = {
  venda: { titulo: 'Contrato de Prestação de Serviços de Corretagem Imobiliária — Venda', verbo: 'venda', preco: 'valor_pedido', precoLabel: 'Preço de venda pedido (R$)',
    comLabel: 'Comissão (% sobre o preço efetivo da venda)', comTxt: (d) => `Pelo resultado útil da intermediação, o CONTRATANTE pagará ao CORRETOR(A) comissão de ${pct(d, 'comissao')} sobre o valor efetivamente praticado na venda, devida quando for assinada a promessa ou escritura de compra e venda, ou recebido o sinal, e paga ${s(d, 'pagamento_comissao')}.` },
  locacao: { titulo: 'Contrato de Prestação de Serviços de Corretagem Imobiliária — Locação', verbo: 'locação', preco: 'valor_pedido', precoLabel: 'Aluguel mensal pedido (R$)',
    comLabel: 'Comissão (% sobre o aluguel, ou nº de aluguéis)', comTxt: (d) => `Pela intermediação que resultar em contrato de locação assinado, o CONTRATANTE pagará ao CORRETOR(A) comissão de ${s(d, 'comissao')}, devida na assinatura do contrato de locação e paga ${s(d, 'pagamento_comissao')}.` },
  arrendamento: { titulo: 'Contrato de Prestação de Serviços de Corretagem Imobiliária — Arrendamento', verbo: 'arrendamento', preco: 'valor_pedido', precoLabel: 'Renda de arrendamento pedida (R$ por ano)',
    comLabel: 'Comissão (% sobre a renda ou valor fixo)', comTxt: (d) => `Pela intermediação que resultar em contrato de arrendamento assinado, o CONTRATANTE pagará ao CORRETOR(A) comissão de ${s(d, 'comissao')}, devida na assinatura do contrato de arrendamento e paga ${s(d, 'pagamento_comissao')}.` },
};
function corretagem(kind: Fin): Template {
  const f = FIN[kind];
  return {
    key: `corretagem_${kind}`, title: f.titulo, category: 'corretagem', version: 1,
    summary: `Autoriza o corretor a intermediar a ${f.verbo}, com prazo, comissão, exclusividade opcional e permissão para anunciar em sites e redes sociais.`,
    sides: { a: 'Contratante (proprietário)', b: 'Contratante (proprietário)' },
    warnings: ['Para anunciar publicamente o imóvel é preciso autorização por escrito do proprietário (Lei 6.530/78): a cláusula de divulgação cumpre isso.', 'Se o imóvel tem mais de um proprietário (ou cônjuge), todos devem assinar.'],
    fields: [
      ...partyFields('a', 'Contratante'), ...corretorFields, ...imovelFields,
      { key: 'valor_pedido', label: f.precoLabel, type: 'money', group: 'Condições', required: true },
      { key: 'condicoes', label: 'Condições aceitas (financiamento, permuta, FGTS…)', type: 'text', group: 'Condições' },
      { key: 'comissao', label: f.comLabel, type: 'text', group: 'Condições', required: true },
      { key: 'pagamento_comissao', label: 'Forma de pagamento da comissão', type: 'text', group: 'Condições', default: 'à vista, por PIX ou transferência bancária' },
      { key: 'prazo_dias', label: 'Prazo da autorização (dias)', type: 'number', group: 'Condições', default: '90' },
      { key: 'prazo_renova', label: 'Renovar sozinha ao fim do prazo?', type: 'select', group: 'Condições', options: sn, default: 'nao' },
      { key: 'exclusividade', label: 'Exclusividade', type: 'select', group: 'Condições', options: [['nao', 'Sem exclusividade'], ['sim', 'Com exclusividade']], default: 'nao' },
      { key: 'protecao_dias', label: 'Proteção após o prazo (dias)', type: 'number', group: 'Condições', default: '180', hint: 'Comissão se fechar com cliente apresentado pelo corretor.' },
      { key: 'divulgar_endereco', label: 'Divulgar o endereço exato nos anúncios?', type: 'select', group: 'Divulgação', options: sn, default: 'nao' },
      { key: 'divulgar_valor', label: 'Divulgar o valor nos anúncios?', type: 'select', group: 'Divulgação', options: sn, default: 'sim' },
      { key: 'divulgar_placa', label: 'Colocar placa no imóvel?', type: 'select', group: 'Divulgação', options: sn, default: 'sim' },
      ...fechamento,
    ],
    build: (d) => compose(f.titulo,
      `Pelo presente instrumento particular, de um lado ${party(d, 'a', 'CONTRATANTE')}; e, de outro, ${corretor(d)}, têm entre si justo e contratado o seguinte:`,
      [
        ['Objeto', `O CONTRATANTE autoriza o(a) CORRETOR(A) a intermediar a ${f.verbo} do imóvel: ${imovelTxt(d)}, declarando ser o legítimo proprietário/possuidor e ter poderes para contratar.`],
        ['Valor e condições', `O imóvel será oferecido por ${money(d, 'valor_pedido')}${has(d, 'condicoes') ? `, aceitando-se: ${d.condicoes}` : ''}. Qualquer proposta será levada ao CONTRATANTE por escrito, e só vale após a sua aceitação expressa.`],
        ['Prazo', `Esta autorização vale por ${s(d, 'prazo_dias')} dias a partir da assinatura. ${d.prazo_renova === 'sim' ? 'Passado o prazo, renova-se automaticamente por igual período, salvo aviso escrito em contrário.' : 'Passado o prazo, não se renova automaticamente.'}`],
        ['Exclusividade', d.exclusividade === 'sim'
          ? `A autorização é concedida COM EXCLUSIVIDADE. Durante o prazo, o CONTRATANTE não contratará outro corretor e encaminhará ao(à) CORRETOR(A) todo interessado que o procurar. Se o negócio for fechado nesse período, mesmo sem a participação do(a) CORRETOR(A), a comissão será devida por inteiro, salvo se ficar comprovada a inércia ou ociosidade do(a) CORRETOR(A) (art. 726 do Código Civil).`
          : `A autorização é concedida SEM EXCLUSIVIDADE: o CONTRATANTE pode contratar outros corretores. A comissão é devida a quem aproximar as partes e levar à conclusão do negócio. Se o CONTRATANTE fechar o negócio diretamente, sem a participação do(a) CORRETOR(A), nada lhe será devido.`],
        ['Remuneração', `${f.comTxt(d)} Se, em até ${s(d, 'protecao_dias')} dias após o fim do prazo ou da rescisão, o negócio for fechado com pessoa apresentada pelo(a) CORRETOR(A) durante a vigência, a comissão continua devida. O(A) CORRETOR(A) não receberá valores do negócio sem recibo e com ciência do CONTRATANTE.`],
        ['Autorização de divulgação', `O CONTRATANTE AUTORIZA, por escrito, a divulgação do imóvel em site próprio da imobiliária, portais imobiliários, redes sociais (como Instagram, Facebook, YouTube e TikTok), aplicativos de mensagem, listas de transmissão e materiais impressos${d.divulgar_placa === 'nao' ? '' : ', inclusive com placa no imóvel'}, usando fotos, vídeos, plantas e descrição do imóvel. ${d.divulgar_valor === 'nao' ? 'O valor não será divulgado.' : 'O valor poderá ser divulgado.'} ${d.divulgar_endereco === 'sim' ? 'O endereço exato poderá ser divulgado.' : 'O endereço exato NÃO será divulgado: apenas bairro e cidade.'} O CONTRATANTE declara ter direito sobre as imagens fornecidas e autoriza o seu uso para esse fim. Nome, telefone e dados pessoais do CONTRATANTE não serão divulgados. A autorização pode ser revogada por escrito e o(a) CORRETOR(A) retirará os anúncios em até 5 dias úteis.`],
        ['Obrigações do corretor', `O(A) CORRETOR(A) executará a mediação com diligência e prudência, prestará ao CONTRATANTE as informações sobre o andamento dos negócios e sobre os riscos que conhecer, e cumprirá o Código de Ética Profissional (art. 723 do Código Civil).`],
        ['Obrigações do contratante', `O CONTRATANTE fornecerá informações verdadeiras e os documentos do imóvel (matrícula atualizada, IPTU, certidões, condomínio) e informará ônus, dívidas, ações judiciais e problemas conhecidos. Responde pela veracidade do que declarar.`],
        ['Proteção de dados', `Os dados pessoais serão usados só para executar este contrato e divulgar o imóvel, e compartilhados apenas com interessados, instituições financeiras e portais quando necessário, conforme a Lei 13.709/2018 (LGPD). O CONTRATANTE pode pedir acesso, correção ou exclusão dos seus dados.`],
        ['Rescisão', `Qualquer parte pode rescindir por escrito, com aviso de 5 dias. Na autorização com exclusividade, a rescisão antes do prazo não afasta a comissão sobre negócio fechado no prazo e na proteção da Cláusula 5ª.`],
        ['Foro', foro(d)],
      ], d, ['CONTRATANTE: ' + s(d, 'a_nome'), 'CORRETOR(A): ' + s(d, 'corretor_nome') + ' — CRECI ' + s(d, 'corretor_creci')]),
  };
}

// ---------- locação ----------
const garantiaTxt = (d: Data) => ({
  fiador: `A garantia é FIANÇA, prestada por ${s(d, 'garantia_detalhe')}, que se obriga como devedor solidário, com renúncia ao benefício de ordem, até a efetiva devolução do imóvel, inclusive após eventual prorrogação por prazo indeterminado.`,
  caucao: `A garantia é CAUÇÃO em dinheiro de ${money(d, 'garantia_valor')} (limitada a 3 aluguéis), depositada em caderneta de poupança em nome do LOCADOR, e devolvida com os rendimentos ao fim da locação, descontados débitos.`,
  seguro: `A garantia é SEGURO-FIANÇA LOCATÍCIA: ${s(d, 'garantia_detalhe')}. O LOCATÁRIO pagará os prêmios e, se a apólice for cancelada, apresentará nova garantia em 30 dias.`,
  titulo: `A garantia é TÍTULO DE CAPITALIZAÇÃO: ${s(d, 'garantia_detalhe')}.`,
  nenhuma: `A locação é feita SEM GARANTIA. O LOCADOR poderá cobrar o aluguel e demais encargos em atraso por todos os meios legais, e a falta de pagamento autoriza a ação de despejo.`,
} as Record<string, string>)[d.garantia ?? 'nenhuma'];

const locFields = (comercial: boolean): Field[] => [
  ...partyFields('a', 'Locador'), ...partyFields('b', 'Locatário'), ...imovelFields,
  { key: 'destinacao', label: 'Destinação do imóvel', type: 'text', group: 'Condições', default: comercial ? 'atividade comercial: ' : 'moradia do LOCATÁRIO e família' },
  { key: 'inicio', label: 'Início da locação', type: 'date', group: 'Condições', required: true },
  { key: 'meses', label: 'Prazo (meses)', type: 'number', group: 'Condições', default: comercial ? '60' : '30', required: true },
  { key: 'valor_aluguel', label: 'Aluguel mensal (R$)', type: 'money', group: 'Condições', required: true },
  { key: 'dia_venc', label: 'Dia de vencimento', type: 'number', group: 'Condições', default: '5' },
  { key: 'forma_pag', label: 'Forma de pagamento', type: 'text', group: 'Condições', default: 'PIX ou depósito na conta indicada pelo LOCADOR' },
  { key: 'indice', label: 'Índice de reajuste anual', type: 'select', group: 'Condições', options: [['IGP-M', 'IGP-M'], ['IPCA', 'IPCA'], ['INPC', 'INPC'], ['IGP-DI', 'IGP-DI']], default: 'IGP-M' },
  { key: 'multa_atraso', label: 'Multa por atraso (%)', type: 'number', group: 'Condições', default: '10' },
  { key: 'juros_mes', label: 'Juros por atraso (% ao mês)', type: 'number', group: 'Condições', default: '1' },
  { key: 'encargos', label: 'Encargos por conta do locatário', type: 'text', group: 'Condições', default: 'IPTU, condomínio ordinário, água, luz, gás e internet' },
  { key: 'garantia', label: 'Garantia', type: 'select', group: 'Garantia', options: [['nenhuma', 'Sem garantia'], ['fiador', 'Fiador'], ['caucao', 'Caução em dinheiro'], ['seguro', 'Seguro-fiança'], ['titulo', 'Título de capitalização']], default: 'nenhuma', hint: 'A lei permite uma só modalidade (Lei 8.245/91, art. 37).' },
  { key: 'garantia_detalhe', label: 'Dados do fiador / apólice / título', type: 'textarea', group: 'Garantia' },
  { key: 'garantia_valor', label: 'Valor da caução (R$)', type: 'money', group: 'Garantia' },
  { key: 'vistoria', label: 'Imóvel entregue conforme vistoria anexa?', type: 'select', group: 'Condições', options: sn, default: 'sim' },
  ...fechamento,
];
function locacao(comercial: boolean): Template {
  const titulo = comercial ? 'Contrato de Locação Comercial de Imóvel' : 'Contrato de Locação Residencial de Imóvel';
  return {
    key: comercial ? 'locacao_comercial' : 'locacao_residencial', title: titulo, category: 'locacao', version: 1,
    summary: comercial ? 'Locação para uso comercial, com reajuste anual, encargos, garantia e multa proporcional.' : 'Locação para moradia, com garantia (fiador, caução, seguro, título ou sem garantia), reajuste anual e multa proporcional.',
    sides: { a: 'Locador (proprietário)', b: 'Locatário (inquilino)' },
    warnings: [comercial ? 'Locação comercial por 5 anos ou mais, com atividade no mesmo ramo por 3 anos, dá direito à ação renovatória (Lei 8.245/91, art. 51): confirme com advogado.' : 'Locação residencial por 30 meses ou mais termina no prazo sem aviso; por menos, vira prazo indeterminado se o locatário continuar.', 'Confirme se há cônjuge a assinar e a regularidade do imóvel.'],
    fields: locFields(comercial),
    build: (d) => compose(titulo,
      `Pelo presente instrumento particular, de um lado ${party(d, 'a', 'LOCADOR')}; e, de outro, ${party(d, 'b', 'LOCATÁRIO')}, ajustam a locação do imóvel descrito abaixo, conforme a Lei 8.245/91 e as cláusulas seguintes:`,
      [
        ['Objeto', `O LOCADOR dá em locação ao LOCATÁRIO o imóvel: ${imovelTxt(d)}. ${d.vistoria === 'nao' ? 'O LOCATÁRIO declara ter vistoriado o imóvel e recebê-lo no estado em que se encontra.' : 'O imóvel é entregue conforme o termo de vistoria anexo, que faz parte deste contrato.'}`],
        ['Destinação', `O imóvel destina-se exclusivamente a ${s(d, 'destinacao')}. É proibido mudar a destinação, sublocar, ceder ou emprestar o imóvel sem consentimento escrito do LOCADOR.`],
        ['Prazo', `A locação vale por ${s(d, 'meses')} meses, de ${dt(d, 'inicio')} a ${dataExtenso(addMonthsISO(d.inicio, Number(d.meses)))}. Ao término, o LOCATÁRIO devolve o imóvel, salvo prorrogação por escrito. Se continuar no imóvel sem oposição do LOCADOR por mais de 30 dias após o prazo, a locação passa a vigorar por prazo indeterminado, com as mesmas condições.`],
        ['Aluguel', `O aluguel mensal é de ${money(d, 'valor_aluguel')}, pago até o dia ${s(d, 'dia_venc')} de cada mês, por ${s(d, 'forma_pag')}. O pagamento de um mês não quita os anteriores.`],
        ['Reajuste', `O aluguel será reajustado a cada 12 meses pela variação acumulada do ${s(d, 'indice')} no período, ou, se extinto, por índice que o substitua.`],
        ['Atraso', `O atraso gera multa de ${pct(d, 'multa_atraso')} sobre o valor devido, juros de ${s(d, 'juros_mes')}% ao mês e correção monetária pelo índice do reajuste. Cobrança por advogado acarreta honorários, na forma da lei.`],
        ['Encargos', `São por conta do LOCATÁRIO, durante a locação: ${s(d, 'encargos')}. As despesas extraordinárias de condomínio e as de estrutura do imóvel são do LOCADOR. O LOCATÁRIO entregará, quando pedido, os comprovantes de pagamento.`],
        ['Garantia', garantiaTxt(d)],
        ['Conservação e obras', `O LOCATÁRIO conservará o imóvel e o devolverá limpo e no estado em que o recebeu, salvo desgaste normal de uso. Reparos de danos causados por ele são por sua conta. Obras e benfeitorias dependem de autorização escrita do LOCADOR; as úteis e necessárias autorizadas serão indenizadas, e as voluptuárias poderão ser retiradas se não danificarem o imóvel.`],
        ['Rescisão', `Se o LOCATÁRIO devolver o imóvel antes do fim do prazo, pagará multa equivalente a 3 aluguéis, proporcional ao tempo que falta para o término (art. 4º da Lei 8.245/91). A multa não é devida se a devolução decorrer de transferência de trabalho, nos termos da lei. A falta de pagamento ou o descumprimento de cláusula autoriza o LOCADOR a rescindir e pedir o despejo.`],
        ['Venda e preferência', `Em caso de venda do imóvel, o LOCATÁRIO terá preferência em igualdade de condições (art. 27 da Lei 8.245/91). A venda não rescinde a locação, se este contrato tiver cláusula de vigência registrada na matrícula; caso contrário, o adquirente poderá denunciá-la no prazo legal.`],
        ['Vistoria', `O LOCADOR poderá vistoriar o imóvel mediante aviso prévio, e na devolução será feita nova vistoria. As chaves só se consideram entregues após a vistoria de saída.`],
        ['Foro', foro(d)],
      ], d, ['LOCADOR: ' + s(d, 'a_nome'), 'LOCATÁRIO: ' + s(d, 'b_nome')]),
  };
}

const temporada: Template = {
  key: 'locacao_temporada', title: 'Contrato de Locação por Temporada', category: 'locacao', version: 1,
  summary: 'Locação de curta duração (até 90 dias) para lazer ou férias, com diária/total, caução e regras de uso.',
  sides: { a: 'Locador (proprietário)', b: 'Locatário (hóspede)' },
  warnings: ['A locação por temporada não pode passar de 90 dias (Lei 8.245/91, art. 48). Depois disso segue as regras da locação comum.', 'Confira as regras do condomínio e a legislação local sobre hospedagem.'],
  fields: [
    ...partyFields('a', 'Locador'), ...partyFields('b', 'Locatário'), ...imovelFields,
    { key: 'entrada', label: 'Entrada (check-in)', type: 'date', group: 'Condições', required: true },
    { key: 'saida', label: 'Saída (check-out)', type: 'date', group: 'Condições', required: true },
    { key: 'horario', label: 'Horários (entrada / saída)', type: 'text', group: 'Condições', default: 'entrada a partir das 14h e saída até as 11h' },
    { key: 'pessoas', label: 'Máximo de pessoas', type: 'number', group: 'Condições', default: '4' },
    { key: 'valor_total', label: 'Valor total da temporada (R$)', type: 'money', group: 'Condições', required: true },
    { key: 'sinal', label: 'Sinal / reserva (R$)', type: 'money', group: 'Condições' },
    { key: 'caucao', label: 'Caução de danos (R$)', type: 'money', group: 'Condições' },
    { key: 'incluso', label: 'O que está incluso', type: 'text', group: 'Condições', default: 'água, luz, internet e taxa de limpeza final' },
    ...fechamento,
  ],
  build: (d) => compose('Contrato de Locação por Temporada',
    `Pelo presente instrumento, de um lado ${party(d, 'a', 'LOCADOR')}; e, de outro, ${party(d, 'b', 'LOCATÁRIO')}, ajustam a locação por temporada, conforme os arts. 48 a 50 da Lei 8.245/91:`,
    [
      ['Objeto', `Locação do imóvel ${imovelTxt(d)}, mobiliado ou não conforme combinado, para fins de lazer/descanso.`],
      ['Período', `De ${dt(d, 'entrada')} a ${dt(d, 'saida')}, com ${s(d, 'horario')}. Terminado o período, o imóvel será devolvido, sem necessidade de aviso.`],
      ['Pessoas', `O imóvel poderá ser ocupado por, no máximo, ${s(d, 'pessoas')} pessoas, sendo proibidas festas e eventos sem autorização.`],
      ['Valor', `O valor total é de ${money(d, 'valor_total')}${has(d, 'sinal') ? `, sendo ${money(d, 'sinal')} pagos como sinal/reserva e o saldo até a entrada` : ', pago integralmente antes da entrada'}. Está incluso: ${s(d, 'incluso')}.`],
      ['Caução', has(d, 'caucao') ? `O LOCATÁRIO deposita caução de ${money(d, 'caucao')}, devolvida em até 5 dias após a saída, descontados danos e débitos apurados em vistoria.` : 'Não há caução, mas o LOCATÁRIO responde por danos ao imóvel e aos móveis.'],
      ['Regras de uso', 'O LOCATÁRIO cumprirá o regulamento do condomínio e a lei do silêncio, cuidará do imóvel e dos móveis e responde pelos seus convidados. Animais só com autorização. É proibido sublocar.'],
      ['Desistência', 'Em caso de desistência, o sinal não é devolvido, salvo se o LOCADOR conseguir nova locação para o mesmo período.'],
      ['Foro', foro(d)],
    ], d, ['LOCADOR: ' + s(d, 'a_nome'), 'LOCATÁRIO: ' + s(d, 'b_nome')], false),
};

// ---------- compra e venda ----------
const compraVenda: Template = {
  key: 'compra_venda', title: 'Contrato Particular de Compromisso de Compra e Venda de Imóvel', category: 'venda', version: 1,
  summary: 'Compra e venda de imóvel com sinal (arras), pagamento à vista, parcelado ou financiado, posse, tributos e escritura.',
  sides: { a: 'Vendedor', b: 'Comprador' },
  warnings: ['Antes de assinar, peça matrícula atualizada (com certidão de ônus), certidões pessoais e do imóvel, e quitação de IPTU e condomínio.', 'A propriedade só se transfere com o registro da escritura na matrícula. Se um vendedor for casado, o cônjuge também assina.', 'Em financiamento bancário, o contrato do banco prevalece sobre as condições que dependem dele.'],
  fields: [
    ...partyFields('a', 'Vendedor'), ...partyFields('b', 'Comprador'), ...imovelFields,
    { key: 'preco', label: 'Preço total (R$)', type: 'money', group: 'Pagamento', required: true },
    { key: 'forma', label: 'Forma de pagamento', type: 'select', group: 'Pagamento', options: [['vista', 'À vista'], ['parcelado', 'Parcelado direto com o vendedor'], ['financiamento', 'Com financiamento bancário']], default: 'vista' },
    { key: 'sinal', label: 'Sinal / arras (R$)', type: 'money', group: 'Pagamento' },
    { key: 'detalhe_pag', label: 'Saldo: datas, parcelas, financiamento / FGTS', type: 'textarea', group: 'Pagamento' },
    { key: 'posse', label: 'Entrega da posse', type: 'text', group: 'Condições', default: 'na quitação do preço (ou na liberação do financiamento)' },
    { key: 'escritura_dias', label: 'Prazo para escritura (dias)', type: 'number', group: 'Condições', default: '60' },
    { key: 'despesas', label: 'ITBI, escritura e registro por conta de', type: 'select', group: 'Condições', options: [['comprador', 'Comprador'], ['vendedor', 'Vendedor'], ['metade', 'Divididos']], default: 'comprador' },
    { key: 'multa', label: 'Multa por descumprimento (%)', type: 'number', group: 'Condições', default: '10' },
    { key: 'corretor_nome', label: 'Corretor(a) que intermediou', type: 'text', group: 'Corretor' },
    { key: 'corretor_creci', label: 'CRECI do corretor', type: 'text', group: 'Corretor' },
    { key: 'comissao', label: 'Comissão de corretagem (valor ou %) e quem paga', type: 'text', group: 'Corretor' },
    ...fechamento,
  ],
  build: (d) => compose('Contrato Particular de Compromisso de Compra e Venda de Imóvel',
    `Pelo presente instrumento, de um lado ${party(d, 'a', 'VENDEDOR')}; e, de outro, ${party(d, 'b', 'COMPRADOR')}, ajustam a compra e venda do imóvel descrito abaixo, mediante as cláusulas seguintes:`,
    [
      ['Objeto', `O VENDEDOR vende ao COMPRADOR o imóvel: ${imovelTxt(d)}, declarando que é de sua propriedade, livre e desembaraçado de ônus, dívidas, penhoras e ações, salvo o que constar expressamente neste contrato.`],
      ['Preço', `O preço total é de ${money(d, 'preco')}.`],
      ['Pagamento', `${d.forma === 'parcelado' ? 'O pagamento será parcelado diretamente ao VENDEDOR' : d.forma === 'financiamento' ? 'O pagamento será feito com recursos próprios e financiamento bancário, que depende da aprovação do crédito pelo banco' : 'O pagamento será à vista'}${has(d, 'sinal') ? `. O COMPRADOR paga, neste ato, ${money(d, 'sinal')} a título de SINAL (arras confirmatórias), que será abatido do preço` : ''}. ${has(d, 'detalhe_pag') ? 'Saldo: ' + d.detalhe_pag + '.' : ''} O VENDEDOR dará quitação de cada pagamento por escrito.`],
      ['Arras', 'Se o COMPRADOR desistir, perde o sinal; se o VENDEDOR desistir, devolve o sinal em dobro, em ambos os casos sem prejuízo de perdas e danos comprovadas (arts. 417 a 420 do Código Civil). Se o negócio não se concluir por reprovação do financiamento sem culpa do COMPRADOR, o sinal será devolvido.'],
      ['Posse', `A posse será entregue ${s(d, 'posse')}. Até lá, impostos, taxas e condomínio são do VENDEDOR; depois, do COMPRADOR.`],
      ['Escritura e registro', `A escritura definitiva será assinada em até ${s(d, 'escritura_dias')} dias da quitação do preço. ITBI, escritura e registro ficam por conta ${d.despesas === 'vendedor' ? 'do VENDEDOR' : d.despesas === 'metade' ? 'de ambas as partes, em partes iguais' : 'do COMPRADOR'}. O VENDEDOR entregará as certidões necessárias.`],
      ['Evicção e vícios', 'O VENDEDOR responde pela evicção (perda do imóvel por direito de terceiro) e informou todos os defeitos que conhece. O COMPRADOR declara ter visitado o imóvel e conferido a documentação.'],
      ['Irretratabilidade e multa', `Este contrato é irretratável e vincula herdeiros e sucessores. A parte que descumprir pagará à outra multa de ${pct(d, 'multa')} sobre o preço, além do que a lei prever.`],
      ['Corretagem', has(d, 'corretor_nome') ? `A intermediação foi feita por ${s(d, 'corretor_nome')}, CRECI ${s(d, 'corretor_creci')}. Comissão: ${s(d, 'comissao')}.` : 'Não houve intermediação de corretor de imóveis.'],
      ['Proteção de dados', 'Os dados pessoais serão usados apenas para este negócio, cartório, registro e obrigações legais (LGPD, Lei 13.709/2018).'],
      ['Foro', foro(d)],
    ], d, ['VENDEDOR: ' + s(d, 'a_nome'), 'COMPRADOR: ' + s(d, 'b_nome')]),
};

const reciboSinal: Template = {
  key: 'recibo_sinal', title: 'Recibo de Sinal e Princípio de Pagamento', category: 'venda', version: 1,
  summary: 'Recibo curto de sinal (arras) para reservar o negócio enquanto o contrato definitivo é preparado.',
  sides: { a: 'Vendedor', b: 'Comprador' },
  warnings: ['O recibo não substitui o contrato de compra e venda: assine o contrato em seguida.'],
  fields: [...partyFields('a', 'Vendedor'), ...partyFields('b', 'Comprador'), ...imovelFields,
    { key: 'preco', label: 'Preço combinado (R$)', type: 'money', group: 'Pagamento', required: true },
    { key: 'sinal', label: 'Valor do sinal (R$)', type: 'money', group: 'Pagamento', required: true },
    { key: 'saldo', label: 'Condições do saldo', type: 'textarea', group: 'Pagamento' },
    { key: 'validade', label: 'Prazo para assinar o contrato (dias)', type: 'number', group: 'Pagamento', default: '15' }, ...fechamento],
  build: (d) => compose('Recibo de Sinal e Princípio de Pagamento',
    `${party(d, 'a', 'VENDEDOR')}, declara ter recebido de ${party(d, 'b', 'COMPRADOR')}, a quantia de ${money(d, 'sinal')}, a título de SINAL E PRINCÍPIO DE PAGAMENTO pela compra do imóvel ${imovelTxt(d)}, pelo preço de ${money(d, 'preco')}.`,
    [
      ['Saldo', has(d, 'saldo') ? d.saldo! : 'O saldo será pago na forma que constar do contrato de compra e venda.'],
      ['Prazo', `As partes assinarão o contrato definitivo em até ${s(d, 'validade')} dias. Se o COMPRADOR desistir, perde o sinal; se o VENDEDOR desistir, devolve-o em dobro (arts. 417 a 420 do Código Civil).`],
      ['Foro', foro(d)],
    ], d, ['VENDEDOR: ' + s(d, 'a_nome'), 'COMPRADOR: ' + s(d, 'b_nome')], false),
};

// ---------- arrendamento rural ----------
const arrendamento: Template = {
  key: 'arrendamento_rural', title: 'Contrato de Arrendamento Rural', category: 'arrendamento', version: 1,
  summary: 'Arrendamento de imóvel rural para lavoura ou pecuária, com área, prazo, renda, conservação e benfeitorias.',
  sides: { a: 'Arrendador (dono da terra)', b: 'Arrendatário (quem usa a terra)' },
  warnings: ['Prazos mínimos (Estatuto da Terra e Decreto 59.566/66): em geral 3 anos para lavoura temporária e pecuária de pequeno/médio porte, 5 anos para lavoura permanente e pecuária de grande porte. Confirme com advogado.', 'A renda não pode passar de 15% do valor cadastral do imóvel (Estatuto da Terra): confira.', 'Confirme CCIR, ITR e CAR em dia.'],
  fields: [
    ...partyFields('a', 'Arrendador'), ...partyFields('b', 'Arrendatário'),
    { key: 'imovel_desc', label: 'Nome e localização do imóvel rural', type: 'textarea', group: 'Imóvel', required: true },
    { key: 'area_ha', label: 'Área arrendada (hectares)', type: 'number', group: 'Imóvel', required: true },
    { key: 'matricula', label: 'Matrícula / cartório', type: 'text', group: 'Imóvel' },
    { key: 'inscricao', label: 'CCIR / NIRF (ITR) / CAR', type: 'text', group: 'Imóvel' },
    { key: 'finalidade', label: 'Finalidade', type: 'select', group: 'Condições', options: [['lavoura temporária (grãos, hortaliças etc.)', 'Lavoura temporária'], ['lavoura permanente (frutas, café etc.)', 'Lavoura permanente'], ['pecuária', 'Pecuária'], ['exploração florestal', 'Floresta']], default: 'lavoura temporária (grãos, hortaliças etc.)' },
    { key: 'inicio', label: 'Início', type: 'date', group: 'Condições', required: true },
    { key: 'anos', label: 'Prazo (anos)', type: 'number', group: 'Condições', default: '3', required: true },
    { key: 'renda', label: 'Renda anual (R$)', type: 'money', group: 'Condições', required: true },
    { key: 'pagamento', label: 'Forma e datas de pagamento', type: 'text', group: 'Condições', default: 'em parcela única, após a colheita, até 30 dias do término da safra' },
    ...fechamento,
  ],
  build: (d) => compose('Contrato de Arrendamento Rural',
    `Pelo presente instrumento, de um lado ${party(d, 'a', 'ARRENDADOR')}; e, de outro, ${party(d, 'b', 'ARRENDATÁRIO')}, ajustam o arrendamento rural abaixo, regido pelo Estatuto da Terra (Lei 4.504/64) e pelo Decreto 59.566/66:`,
    [
      ['Objeto', `O ARRENDADOR cede ao ARRENDATÁRIO, para uso e exploração, ${s(d, 'area_ha')} hectares do imóvel rural: ${imovelTxt(d)}.`],
      ['Finalidade', `A área será usada exclusivamente para ${s(d, 'finalidade')}, com boas práticas de conservação do solo, da água e da vegetação.`],
      ['Prazo', `O arrendamento vale por ${s(d, 'anos')} ano(s), de ${dt(d, 'inicio')} a ${dataExtenso(addMonthsISO(d.inicio, Number(d.anos) * 12))}. Findo o prazo, a área será devolvida, salvo renovação por escrito; o ARRENDADOR avisará o ARRENDATÁRIO com antecedência legal de 6 meses se não pretender renovar.`],
      ['Renda', `A renda é de ${money(d, 'renda')} por ano, paga ${s(d, 'pagamento')}.`],
      ['Obrigações do arrendatário', 'Cuidar da terra, de cercas, aceiros e benfeitorias, cumprir a legislação ambiental e trabalhista, não subarrendar nem ceder sem autorização escrita, e devolver a área em bom estado.'],
      ['Obrigações do arrendador', 'Entregar a área em condições de uso, garantir o uso pacífico, manter os documentos do imóvel regulares e pagar o ITR.'],
      ['Benfeitorias', 'Benfeitorias necessárias e as úteis autorizadas por escrito serão indenizadas ao fim do arrendamento; as não autorizadas não serão indenizadas.'],
      ['Preferência', 'O ARRENDATÁRIO tem preferência na renovação e na compra do imóvel em igualdade de condições (Estatuto da Terra).'],
      ['Rescisão', 'A falta de pagamento, o desvio de finalidade ou o subarrendamento sem autorização permitem rescindir o contrato, sem prejuízo de perdas e danos.'],
      ['Foro', foro(d)],
    ], d, ['ARRENDADOR: ' + s(d, 'a_nome'), 'ARRENDATÁRIO: ' + s(d, 'b_nome')]),
};

// ---------- avaliação ----------
const avaliacao: Template = {
  key: 'avaliacao_imovel', title: 'Contrato de Prestação de Serviços de Avaliação de Imóvel', category: 'avaliacao', version: 1,
  summary: 'Contrata o corretor para elaborar parecer de avaliação mercadológica (PTAM) do imóvel, com honorários, prazo e finalidade.',
  sides: { a: 'Contratante', b: 'Contratante' },
  warnings: ['O parecer do corretor (PTAM) é uma opinião de valor de mercado e NÃO é laudo de engenharia (NBR 14653). Para bancos, ações judiciais e inventários, confirme se o PTAM é aceito.', 'Os honorários não podem depender do valor atribuído ao imóvel.'],
  fields: [
    ...partyFields('a', 'Contratante'), ...corretorFields, ...imovelFields,
    { key: 'finalidade', label: 'Finalidade da avaliação', type: 'select', group: 'Serviço', options: [['venda', 'Venda'], ['locação', 'Locação'], ['partilha ou inventário', 'Partilha / inventário'], ['garantia', 'Garantia'], ['conhecimento do valor de mercado', 'Conhecimento do valor']], default: 'venda' },
    { key: 'visita', label: 'Data da vistoria ao imóvel', type: 'date', group: 'Serviço' },
    { key: 'entrega_dias', label: 'Prazo de entrega do parecer (dias úteis)', type: 'number', group: 'Serviço', default: '7' },
    { key: 'validade_dias', label: 'Validade do parecer (dias)', type: 'number', group: 'Serviço', default: '90' },
    { key: 'honorarios', label: 'Honorários (R$)', type: 'money', group: 'Serviço', required: true },
    { key: 'pagamento', label: 'Forma de pagamento', type: 'text', group: 'Serviço', default: '50% na contratação e 50% na entrega do parecer' },
    ...fechamento,
  ],
  build: (d) => compose('Contrato de Prestação de Serviços de Avaliação de Imóvel',
    `Pelo presente instrumento, de um lado ${party(d, 'a', 'CONTRATANTE')}; e, de outro, ${corretor(d)}, ajustam a prestação do serviço de avaliação abaixo:`,
    [
      ['Objeto', `O(A) CORRETOR(A) elaborará Parecer Técnico de Avaliação Mercadológica (PTAM) do imóvel: ${imovelTxt(d)}, para a finalidade de ${s(d, 'finalidade')}.`],
      ['Método', 'O valor será estimado pelo método comparativo direto de dados de mercado, com pesquisa de imóveis semelhantes na região, análise de localização, área, conservação, padrão e documentação, e vistoria ao imóvel.'],
      ['Vistoria e documentos', `A vistoria será em ${dt(d, 'visita')}. O CONTRATANTE dará acesso ao imóvel e entregará os documentos disponíveis (matrícula, IPTU, planta, condomínio) e informará problemas e ônus que conheça. O parecer se baseia nessas informações.`],
      ['Prazo', `O parecer será entregue em até ${s(d, 'entrega_dias')} dias úteis após a vistoria e o recebimento dos documentos, por escrito, assinado pelo(a) CORRETOR(A).`],
      ['Honorários', `Pelo serviço, o CONTRATANTE pagará ${money(d, 'honorarios')}, ${s(d, 'pagamento')}. Os honorários não dependem do valor atribuído ao imóvel nem de venda, locação ou outro negócio posterior, e são devidos ainda que o CONTRATANTE não use o parecer.`],
      ['Natureza e validade', `O parecer expressa opinião fundamentada de valor de mercado, não é laudo de engenharia de avaliações, não garante preço de venda e vale por ${s(d, 'validade_dias')} dias, pois o mercado muda. O(A) CORRETOR(A) declara não ter interesse no imóvel que afete a sua imparcialidade.`],
      ['Sigilo e dados', 'O(A) CORRETOR(A) manterá sigilo das informações recebidas e as usará só para este serviço, conforme a LGPD (Lei 13.709/2018). O parecer não será divulgado sem autorização do CONTRATANTE.'],
      ['Cancelamento', 'Se o CONTRATANTE cancelar depois da vistoria, são devidos os honorários proporcionais ao trabalho realizado, no mínimo o que já foi pago.'],
      ['Foro', foro(d)],
    ], d, ['CONTRATANTE: ' + s(d, 'a_nome'), 'CORRETOR(A): ' + s(d, 'corretor_nome') + ' — CRECI ' + s(d, 'corretor_creci')], false),
};

export const TEMPLATES: Template[] = [
  corretagem('venda'), corretagem('locacao'), corretagem('arrendamento'),
  locacao(false), locacao(true), temporada,
  compraVenda, reciboSinal, arrendamento, avaliacao,
];
export const templateByKey = (k: string) => TEMPLATES.find((t) => t.key === k);
export const CATEGORY_LABEL: Record<Category, string> = { corretagem: 'Prestação de serviço de corretagem', locacao: 'Locação', venda: 'Compra e venda', arrendamento: 'Arrendamento', avaliacao: 'Avaliação de imóvel' };

/** Valores iniciais: padrões do modelo + o que for informado (campos em branco ficam com a linha para preencher à mão). */
export function defaults(t: Template, given: Data = {}): Data {
  const out: Data = {};
  for (const f of t.fields) if (f.default !== undefined) out[f.key] = f.default;
  for (const [k, v] of Object.entries(given)) if (v !== undefined && v !== '' && t.fields.some((f) => f.key === k)) out[k] = String(v);
  return out;
}
