// Mensagem pronta de WhatsApp e regras de alerta de novos imóveis (funções puras, testáveis).
const brl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(n);
const PURPOSE_LABEL: Record<string, string> = { venda: 'à venda', aluguel: 'para alugar', temporada: 'para temporada', arrendamento: 'para arrendamento' };
const ROTULO: Record<string, string> = { venda: 'Venda', aluguel: 'Aluguel', temporada: 'Diária de referência', arrendamento: 'Arrendamento' };

export interface MsgProp {
  title: string; kind: string; subtype?: string | null; purposes: string[]; city?: string | null; state?: string | null; neighborhood?: string | null;
  price_sale?: number | null; price_rent?: number | null; price_lease?: number | null; show_price?: boolean;
  bedrooms?: number | null; bathrooms?: number | null; parking?: number | null; area_total?: number | null; area_unit?: string | null;
  location_tags?: string[]; coastal_details?: any;
}
const AREA: Record<string, string> = { m2: 'm²', ha: 'ha', alqueire: 'alqueires' };

/** Texto pronto para colar no WhatsApp, adaptado ao tipo de imóvel e à finalidade. Sem dados privados (endereço exato, proprietário). */
export function whatsappMessage(p: MsgProp, link: string | null, purpose?: string, agency?: string): string {
  const pur = purpose && p.purposes.includes(purpose) ? purpose : p.purposes[0];
  const place = [p.neighborhood, p.city && `${p.city}${p.state ? '/' + p.state : ''}`].filter(Boolean).join(', ');
  const price = !p.show_price ? null : pur === 'venda' ? p.price_sale : pur === 'arrendamento' ? p.price_lease : (pur === 'aluguel' || pur === 'temporada') ? p.price_rent : null;
  const rural = p.kind === 'rural';
  const L: string[] = [];
  L.push(`*${p.title}*${pur ? ` — ${PURPOSE_LABEL[pur] ?? pur}` : ''}`);
  if (place) L.push(`📍 ${place}`);
  if (price != null) L.push(`💰 ${ROTULO[pur ?? ''] ?? 'Valor'}: ${brl(price)}${pur === 'aluguel' ? '/mês' : pur === 'arrendamento' ? '/ano' : pur === 'temporada' ? '/diária' : ''}`);
  else if (p.show_price === false) L.push('💰 Valor sob consulta');
  const f: string[] = [];
  if (p.area_total) f.push(`${Number(p.area_total).toLocaleString('pt-BR')} ${AREA[p.area_unit ?? ''] ?? ''}`.trim());
  if (!rural || p.bedrooms) { if (p.bedrooms != null) f.push(`${p.bedrooms} ${p.bedrooms === 1 ? 'quarto' : 'quartos'}`); if (p.bathrooms != null) f.push(`${p.bathrooms} banh.`); if (p.parking != null) f.push(`${p.parking} ${p.parking === 1 ? 'vaga' : 'vagas'}`); }
  if (f.length) L.push(`🏠 ${f.join(' · ')}`);
  const c = p.coastal_details ?? {};
  if (pur === 'temporada' || (p.location_tags ?? []).includes('litoral')) {
    if (c.beach_distance_m != null) L.push(`🌊 A ${c.beach_distance_m} m da praia${c.sea_view ? ' · vista para o mar' : ''}`);
    if (c.guests_capacity != null) L.push(`👥 Até ${c.guests_capacity} hóspedes`);
  }
  if (rural) L.push('🌾 Imóvel rural — posso enviar documentação e localização sob consulta.');
  if (link) L.push(`\nVeja fotos e detalhes: ${link}`);
  L.push(`\nTem interesse? Posso agendar uma visita.${agency ? `\n— ${agency}` : ''}`);
  return L.join('\n');
}

export interface AlertRow { purpose?: string | null; kind?: string | null; city?: string | null; max_price?: number | null; min_bedrooms?: number | null }
export interface AlertProp { purposes: string[]; kind: string; city?: string | null; price_sale?: number | null; price_rent?: number | null; price_lease?: number | null; show_price?: boolean; bedrooms?: number | null }
const norm = (s?: string | null) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** O imóvel combina com o pedido de aviso? Critério vazio = qualquer. Preço oculto só passa se não houver teto de preço. */
export function alertMatches(a: AlertRow, p: AlertProp): boolean {
  if (a.purpose && !p.purposes.includes(a.purpose)) return false;
  if (a.kind && a.kind !== p.kind) return false;
  if (a.city && norm(a.city) !== norm(p.city)) return false;
  if (a.min_bedrooms != null && (p.bedrooms ?? 0) < a.min_bedrooms) return false;
  if (a.max_price != null) {
    const pur = a.purpose ?? p.purposes[0];
    const v = pur === 'venda' ? p.price_sale : pur === 'arrendamento' ? p.price_lease : p.price_rent;
    if (!p.show_price || v == null || Number(v) > Number(a.max_price)) return false;
  }
  return true;
}
