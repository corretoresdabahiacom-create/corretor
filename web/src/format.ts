export const brl = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const dateBR = (v: string | Date | null | undefined) =>
  v ? new Date(v).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';

export const dateTimeBR = (v: string | Date | null | undefined) =>
  v ? new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

export const timeBR = (v: string | Date) =>
  new Date(v).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

const digits = (s: string) => s.replace(/\D/g, '');

export const maskCPFCNPJ = (v: string) => {
  const d = digits(v).slice(0, 14);
  if (d.length <= 11) return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2');
};
export const maskPhone = (v: string) => {
  const d = digits(v).slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d{1,4})$/, '$1-$2');
  return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d{1,4})$/, '$1-$2');
};
export const maskCEP = (v: string) => digits(v).slice(0, 8).replace(/(\d{5})(\d{1,3})$/, '$1-$2');

/** Converte texto digitado ("1.250,50") em número. */
export const parseMoney = (v: string): number | null => {
  const s = v.replace(/[^\d,]/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
export const formatMoneyInput = (n: number | null | undefined) =>
  n == null ? '' : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const LABELS: Record<string, string> = {
  // papéis
  comprador: 'Comprador', vendedor: 'Vendedor', interessado: 'Interessado', proprietario: 'Proprietário', locador: 'Locador',
  locatario: 'Locatário', arrendador: 'Arrendador', arrendatario: 'Arrendatário', fiador: 'Fiador/garantidor', corretor: 'Corretor',
  parceiro: 'Parceiro comercial', contato_referencia: 'Contato de referência',
  // imóveis
  urbano: 'Urbano', rural: 'Rural', casa: 'Casa', apartamento: 'Apartamento', cobertura: 'Cobertura', kitnet: 'Kitnet', terreno: 'Terreno',
  sala_comercial: 'Sala comercial', loja: 'Loja', galpao: 'Galpão', predio: 'Prédio', outro: 'Outro', fazenda: 'Fazenda', sitio: 'Sítio',
  chacara: 'Chácara', terreno_rural: 'Terreno rural', propriedade_produtiva: 'Propriedade produtiva',
  venda: 'Venda', aluguel: 'Aluguel', temporada: 'Temporada', arrendamento: 'Arrendamento',
  em_preparacao: 'Em preparação', disponivel: 'Disponível', reservado: 'Reservado', em_negociacao: 'Em negociação', vendido: 'Vendido',
  alugado: 'Alugado', arrendado: 'Arrendado', indisponivel: 'Indisponível', arquivado: 'Arquivado',
  litoral: 'Litoral', serra: 'Serra', lago_represa: 'Lago/represa', campo: 'Campo',
  // agenda
  visita: 'Visita', reuniao: 'Reunião', captacao: 'Captação', avaliacao: 'Avaliação', vistoria: 'Vistoria', assinatura: 'Assinatura',
  retorno: 'Retorno a cliente', tarefa: 'Tarefa interna', vencimento: 'Vencimento',
  agendado: 'Agendado', concluido: 'Concluído', cancelado: 'Cancelado', reagendado: 'Reagendado',
  // perfis
  admin: 'Administrador', gestor: 'Gestor', assistente: 'Assistente', consulta: 'Consulta',
  ativo: 'Ativo', aguardando_retorno: 'Aguardando retorno', inativo: 'Inativo',
  m2: 'm²', ha: 'ha', alqueire: 'alqueire',
};
export const L = (k: string | null | undefined) => (k ? LABELS[k] ?? k : '—');

/** Valor curto para indicadores (ex.: R$ 1,49 mi). */
export const brlShort = (v: number | null | undefined) => v == null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: Math.abs(v) >= 100000 ? 'compact' : 'standard', maximumFractionDigits: Math.abs(v) >= 100000 ? 2 : 0 }).format(v);
