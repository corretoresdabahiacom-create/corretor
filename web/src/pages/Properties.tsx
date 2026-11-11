import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, del, get, patch, post, put, qs } from '../api';
import { useSession } from '../session';
import { Async, Empty, Field, Modal, MultiToggle, Pager, StatusChip, Toggle, useAsync, useConfirm, useToast } from '../ui';
import { FilesPanel } from './Files';
import { Icon } from '../icons';
import { PortalCard } from './Portal';
import { brl, formatMoneyInput, L, maskCEP, parseMoney } from '../format';

const URBAN = ['casa', 'apartamento', 'cobertura', 'kitnet', 'terreno', 'sala_comercial', 'loja', 'galpao', 'predio', 'outro'];
const RURAL = ['fazenda', 'sitio', 'chacara', 'terreno_rural', 'propriedade_produtiva', 'outro'];
const PURPOSES: [string, string][] = [['venda', 'Venda'], ['aluguel', 'Aluguel'], ['temporada', 'Temporada'], ['arrendamento', 'Arrendamento']];
const TAGS: [string, string][] = [['litoral', 'Litoral / praia'], ['serra', 'Serra'], ['lago_represa', 'Lago / represa'], ['campo', 'Campo']];
const STATUS = ['em_preparacao', 'disponivel', 'reservado', 'em_negociacao', 'vendido', 'alugado', 'arrendado', 'indisponivel', 'arquivado'];
const FEATURES = ['churrasqueira', 'piscina', 'elevador', 'mobiliado', 'acessibilidade', 'portaria', 'energia', 'poço artesiano', 'represa', 'curral'];
const priceOf = (p: any) => p.display_price ?? p.price_sale ?? p.price_rent ?? p.price_lease;
const areaTxt = (p: any) => (p.area_total ? `${p.area_total.toLocaleString('pt-BR')} ${L(p.area_unit)}` : '—');

function Money({ label, value, onChange, error }: { label: string; value: number | null | undefined; onChange: (n: number | null) => void; error?: string }) {
  const [txt, setTxt] = useState(formatMoneyInput(value));
  return <Field label={label} error={error} hint="Ex.: 650.000,00"><input inputMode="decimal" value={txt} onChange={(e) => { setTxt(e.target.value); onChange(parseMoney(e.target.value)); }} onBlur={() => setTxt(formatMoneyInput(parseMoney(txt)))} /></Field>;
}
const numIn = (v: string) => (v === '' ? null : Number(v.replace(/\./g, '').replace(',', '.')));

function PropertyForm({ initial, onSaved, onClose }: { initial?: any; onSaved: (p: any) => void; onClose: () => void }) {
  const edit = !!initial?.id;
  const { can } = useSession();
  const [f, setF] = useState<any>(() => ({
    title: '', description: '', kind: 'urbano', subtype: 'casa', purposes: ['venda'], location_tags: [], status: 'em_preparacao', address: {}, features: [],
    area_unit: 'm2', rural_details: {}, coastal_details: {}, publish_authorized: false, show_exact_location: false, show_price: true, internal_notes: '', ...initial,
  }));
  const [step, setStep] = useState(0);
  const [geoBusy, setGeoBusy] = useState(false); const [geoMsg, setGeoMsg] = useState('');
  const locate = async () => {
    const a = f.address ?? {}; const query = [a.logradouro, a.numero, a.bairro, a.cidade, a.uf].filter(Boolean).join(', ');
    setGeoMsg(''); setGeoBusy(true);
    try { const r = await get(`/api/geocode?q=${encodeURIComponent(query)}`); setF((x: any) => ({ ...x, latitude: Number(r.lat.toFixed(6)), longitude: Number(r.lng.toFixed(6)) })); setGeoMsg(`Encontrado: ${r.label}`); }
    catch (e) { setGeoMsg(e instanceof ApiError ? e.message : 'Não foi possível localizar.'); } finally { setGeoBusy(false); }
  };
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));
  const setAddr = (k: string, v: string) => setF((s: any) => ({ ...s, address: { ...s.address, [k]: v } }));
  const setRural = (k: string, v: any) => setF((s: any) => ({ ...s, rural_details: { ...s.rural_details, [k]: v } }));
  const setCoast = (k: string, v: any) => setF((s: any) => ({ ...s, coastal_details: { ...s.coastal_details, [k]: v } }));
  const coastal = f.location_tags.includes('litoral');
  const owners = useAsync(() => get('/api/people?role=proprietario&pageSize=100&sort=name'), []);
  const steps = ['Básico', 'Localização', 'Valores e áreas', 'Detalhes', 'Divulgação'];

  const save = async () => {
    setBusy(true); setMsg(''); setErrors({});
    const body = { ...f }; for (const k of ['id', 'org_id', 'code', 'created_at', 'updated_at', 'created_by', 'updated_by', 'public_slug', 'city', 'state', 'neighborhood', 'display_price', 'is_favorite', 'owner', 'captured_at']) delete body[k];
    if (!can('properties.internal')) delete body.internal_notes;
    try { onSaved(edit ? await patch(`/api/properties/${initial.id}`, body) : await post('/api/properties', body)); }
    catch (e) {
      const fe: Record<string, string> = {}; (e instanceof ApiError ? e.body.fields ?? [] : []).forEach((x: any) => (fe[x.path.split('.')[0]] = x.message));
      setErrors(fe); setMsg(e instanceof ApiError ? e.message : 'Erro inesperado.');
      if (fe.title || fe.subtype || fe.purposes) setStep(0); else if (fe.price_sale || fe.price_rent || fe.price_lease || fe.area_unit) setStep(2);
    } finally { setBusy(false); }
  };

  return (
    <Modal title={edit ? 'Editar imóvel' : 'Novo imóvel'} onClose={onClose}>
      <div className="steps" aria-hidden>{steps.map((_, i) => <i key={i} className={i <= step ? 'on' : ''} />)}</div>
      <p className="muted small">Etapa {step + 1} de {steps.length}: {steps[step]}</p>
      <form className="stack" onSubmit={(e: FormEvent) => { e.preventDefault(); step < steps.length - 1 ? setStep(step + 1) : save(); }}>
        {step === 0 && <>
          <Field label="Título do anúncio" error={errors.title} hint="Ex.: Casa 3 quartos com churrasqueira no Centro"><input required autoFocus value={f.title} onChange={(e) => set('title', e.target.value)} /></Field>
          <Field label="Tipo de imóvel">
            <div className="row"><label className="toggle"><input type="radio" checked={f.kind === 'urbano'} onChange={() => { set('kind', 'urbano'); set('subtype', 'casa'); if (f.area_unit === 'alqueire') set('area_unit', 'm2'); }} /> Urbano</label><label className="toggle"><input type="radio" checked={f.kind === 'rural'} onChange={() => { set('kind', 'rural'); set('subtype', 'fazenda'); set('area_unit', 'ha'); }} /> Rural</label></div>
          </Field>
          <Field label="Categoria" error={errors.subtype}><select value={f.subtype} onChange={(e) => set('subtype', e.target.value)}>{(f.kind === 'urbano' ? URBAN : RURAL).map((s) => <option key={s} value={s}>{L(s)}</option>)}</select></Field>
          <Field label="Finalidade" error={errors.purposes} hint="Pode marcar mais de uma."><MultiToggle options={PURPOSES} value={f.purposes} onChange={(v) => set('purposes', v)} /></Field>
          <Field label="Localização geográfica" hint="Independe do tipo: uma casa urbana pode ser de praia."><MultiToggle options={TAGS} value={f.location_tags} onChange={(v) => set('location_tags', v)} /></Field>
          <Field label="Descrição"><textarea value={f.description ?? ''} onChange={(e) => set('description', e.target.value)} /></Field>
        </>}
        {step === 1 && <>
          <Field label="CEP"><input inputMode="numeric" value={f.address.cep ?? ''} onChange={(e) => setAddr('cep', maskCEP(e.target.value))} /></Field>
          <Field label="Logradouro / acesso" hint={f.kind === 'rural' ? 'Ex.: Rodovia SP-322, km 45, estrada vicinal à direita' : 'Rua e número'}><input value={f.address.logradouro ?? ''} onChange={(e) => setAddr('logradouro', e.target.value)} /></Field>
          <div className="grid g2">
            <Field label="Bairro / localidade"><input value={f.address.bairro ?? ''} onChange={(e) => setAddr('bairro', e.target.value)} /></Field>
            <Field label="Cidade"><input required value={f.address.cidade ?? ''} onChange={(e) => setAddr('cidade', e.target.value)} /></Field>
          </div>
          <Field label="Estado (UF)"><input maxLength={2} style={{ textTransform: 'uppercase' }} required value={f.address.uf ?? ''} onChange={(e) => setAddr('uf', e.target.value.toUpperCase())} /></Field>
          <div className="grid g2">
            <Field label="Latitude" hint="Opcional. Ex.: -22.9056"><input inputMode="decimal" value={f.latitude ?? ''} onChange={(e) => set('latitude', e.target.value === '' ? null : Number(e.target.value.replace(',', '.')))} /></Field>
            <Field label="Longitude" hint="Opcional. Ex.: -47.0608"><input inputMode="decimal" value={f.longitude ?? ''} onChange={(e) => set('longitude', e.target.value === '' ? null : Number(e.target.value.replace(',', '.')))} /></Field>
          </div>
          <div className="row"><button type="button" className="btn small" disabled={geoBusy} onClick={locate}>{geoBusy ? 'Buscando…' : 'Localizar pelo endereço'}</button>
            <span className="small muted">Preenche latitude e longitude para o mapa. Sem “mostrar localização exata”, o site público mostra só uma região aproximada.</span></div>
          {geoMsg && <div className="alert warn small" role="status">{geoMsg}</div>}
        </>}
        {step === 2 && <>
          {f.purposes.includes('venda') && <Money label="Preço de venda (R$)" value={f.price_sale} onChange={(n) => set('price_sale', n)} error={errors.price_sale} />}
          {(f.purposes.includes('aluguel') || f.purposes.includes('temporada')) && <Money label={f.purposes.includes('temporada') && !f.purposes.includes('aluguel') ? 'Diária / valor de referência (R$)' : 'Aluguel mensal (R$)'} value={f.price_rent} onChange={(n) => set('price_rent', n)} error={errors.price_rent} />}
          {f.purposes.includes('arrendamento') && <Money label="Valor do arrendamento (R$)" value={f.price_lease} onChange={(n) => set('price_lease', n)} error={errors.price_lease} />}
          <div className="grid g2">
            <Field label="Área total"><input inputMode="decimal" value={f.area_total ?? ''} onChange={(e) => set('area_total', numIn(e.target.value))} /></Field>
            <Field label="Unidade" error={errors.area_unit}><select value={f.area_unit} onChange={(e) => set('area_unit', e.target.value)}><option value="m2">m²</option><option value="ha">hectares</option>{f.kind === 'rural' && <option value="alqueire">alqueires</option>}</select></Field>
          </div>
          {f.kind === 'urbano' && <>
            <Field label="Área construída (m²)"><input inputMode="decimal" value={f.area_built ?? ''} onChange={(e) => set('area_built', numIn(e.target.value))} /></Field>
            <div className="grid g2">
              <Field label="Quartos"><input inputMode="numeric" value={f.bedrooms ?? ''} onChange={(e) => set('bedrooms', numIn(e.target.value))} /></Field>
              <Field label="Suítes"><input inputMode="numeric" value={f.suites ?? ''} onChange={(e) => set('suites', numIn(e.target.value))} /></Field>
              <Field label="Banheiros"><input inputMode="numeric" value={f.bathrooms ?? ''} onChange={(e) => set('bathrooms', numIn(e.target.value))} /></Field>
              <Field label="Vagas"><input inputMode="numeric" value={f.parking ?? ''} onChange={(e) => set('parking', numIn(e.target.value))} /></Field>
            </div>
            <div className="grid g2">
              <Money label="Condomínio (R$/mês)" value={f.recurring_fees?.condominio} onChange={(n) => set('recurring_fees', { ...f.recurring_fees, ...(n == null ? {} : { condominio: n }) })} />
              <Money label="IPTU (R$/mês)" value={f.recurring_fees?.iptu} onChange={(n) => set('recurring_fees', { ...f.recurring_fees, ...(n == null ? {} : { iptu: n }) })} />
            </div>
          </>}
        </>}
        {step === 3 && <>
          <Field label="Características"><MultiToggle options={FEATURES.map((x) => [x, x])} value={f.features} onChange={(v) => set('features', v)} /></Field>
          {f.kind === 'rural' && <>
            <h3>Dados rurais</h3>
            <div className="grid g2">
              <Field label={`Área agricultável (${L(f.area_unit)})`}><input inputMode="decimal" value={f.rural_details.area_agricultable ?? ''} onChange={(e) => setRural('area_agricultable', numIn(e.target.value) ?? undefined)} /></Field>
              <Field label={`Pastagem (${L(f.area_unit)})`}><input inputMode="decimal" value={f.rural_details.area_pasture ?? ''} onChange={(e) => setRural('area_pasture', numIn(e.target.value) ?? undefined)} /></Field>
              <Field label={`Reserva (${L(f.area_unit)})`}><input inputMode="decimal" value={f.rural_details.area_reserve ?? ''} onChange={(e) => setRural('area_reserve', numIn(e.target.value) ?? undefined)} /></Field>
            </div>
            <Field label="Fontes de água" hint="Separe por vírgula. Ex.: rio, poço, nascente"><input value={(f.rural_details.water_sources ?? []).join(', ')} onChange={(e) => setRural('water_sources', e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean))} /></Field>
            <Field label="Atividades produtivas" hint="Ex.: pecuária, soja, café"><input value={(f.rural_details.activities ?? []).join(', ')} onChange={(e) => setRural('activities', e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean))} /></Field>
            <Field label="Benfeitorias"><input value={(f.rural_details.improvements ?? []).join(', ')} onChange={(e) => setRural('improvements', e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean))} /></Field>
            <Field label="Acesso e condições de visita"><textarea value={f.rural_details.visit_conditions ?? ''} onChange={(e) => setRural('visit_conditions', e.target.value)} /></Field>
            <div className="alert warn small"><b>Documentação declarada.</b> Os dados abaixo são informados pelo proprietário. O sistema <u>não</u> atesta regularidade fundiária ou ambiental — isso exige verificação documental.</div>
            <div className="grid g2">
              {[['matricula', 'Matrícula'], ['car', 'CAR'], ['ccir', 'CCIR'], ['itr_nirf', 'ITR (NIRF)'], ['incra_code', 'Código INCRA']].map(([k, l]) => (
                <Field key={k} label={l}><input value={f.rural_details.registry?.[k] ?? ''} onChange={(e) => setRural('registry', { ...(f.rural_details.registry ?? {}), [k]: e.target.value })} /></Field>
              ))}
            </div>
            <label className="row"><input type="checkbox" checked={!!f.rural_details.registry?.georreferenciado} onChange={(e) => setRural('registry', { ...(f.rural_details.registry ?? {}), georreferenciado: e.target.checked })} /> Declarado como georreferenciado</label>
          </>}
          {coastal && <>
            <h3>Dados de litoral / temporada</h3>
            <div className="grid g2">
              <Field label="Distância da praia (m)"><input inputMode="numeric" value={f.coastal_details.beach_distance_m ?? ''} onChange={(e) => setCoast('beach_distance_m', numIn(e.target.value) ?? undefined)} /></Field>
              <Field label="Origem da medida"><select value={f.coastal_details.beach_distance_source ?? ''} onChange={(e) => setCoast('beach_distance_source', e.target.value || undefined)}><option value="">—</option><option value="informada">Informada pelo proprietário</option><option value="estimada">Estimada</option><option value="medida">Medida em mapa</option></select></Field>
              <Field label="Hóspedes (capacidade)"><input inputMode="numeric" value={f.coastal_details.guests_capacity ?? ''} onChange={(e) => setCoast('guests_capacity', numIn(e.target.value) ?? undefined)} /></Field>
              <Field label="Camas"><input inputMode="numeric" value={f.coastal_details.beds ?? ''} onChange={(e) => setCoast('beds', numIn(e.target.value) ?? undefined)} /></Field>
              <Field label="Taxa de limpeza (R$)"><input inputMode="decimal" value={f.coastal_details.cleaning_fee ?? ''} onChange={(e) => setCoast('cleaning_fee', numIn(e.target.value) ?? undefined)} /></Field>
            </div>
            <Field label="Acesso à praia"><input value={f.coastal_details.beach_access ?? ''} onChange={(e) => setCoast('beach_access', e.target.value)} /></Field>
            <label className="row"><input type="checkbox" checked={!!f.coastal_details.sea_view} onChange={(e) => setCoast('sea_view', e.target.checked)} /> Vista para o mar</label>
            <Field label="Regras de temporada e condições de reserva"><textarea value={f.coastal_details.season_rules ?? ''} onChange={(e) => setCoast('season_rules', e.target.value)} /></Field>
          </>}
        </>}
        {step === 4 && <>
          <Field label="Proprietário" hint="Cadastre antes em Pessoas, com o papel “Proprietário”.">
            <select value={f.owner_person_id ?? ''} onChange={(e) => set('owner_person_id', e.target.value || null)}><option value="">— não informado —</option>{(owners.data?.items ?? []).map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
          </Field>
          <Field label="Situação comercial"><select value={f.status} onChange={(e) => set('status', e.target.value)}>{STATUS.map((s) => <option key={s} value={s}>{L(s)}</option>)}</select></Field>
          {can('properties.internal') && <Field label="Observações internas"><textarea value={f.internal_notes ?? ''} onChange={(e) => set('internal_notes', e.target.value)} /></Field>}
          <div className="card stack"><h3>Divulgação</h3>
            <label className="row"><input type="checkbox" checked={f.publish_authorized} onChange={(e) => set('publish_authorized', e.target.checked)} /> O proprietário autorizou a divulgação deste imóvel</label>
            <label className="row"><input type="checkbox" checked={f.show_price} onChange={(e) => set('show_price', e.target.checked)} /> Mostrar preço publicamente</label>
            <label className="row"><input type="checkbox" checked={f.show_exact_location} onChange={(e) => set('show_exact_location', e.target.checked)} /> Mostrar endereço exato (senão, só bairro/cidade)</label>
            <p className="small muted">A página pública é criada na Fase 3. Esta autorização já fica registrada.</p>
          </div>
        </>}
        {msg && <div className="alert err" role="alert">{msg}</div>}
        <div className="row">{step > 0 && <button type="button" className="btn" onClick={() => setStep(step - 1)}>Voltar</button>}<button className="btn primary right" disabled={busy}>{step < steps.length - 1 ? 'Continuar' : busy ? 'Salvando…' : 'Salvar imóvel'}</button></div>
      </form>
    </Modal>
  );
}

export function PropertiesList() {
  const [sp, setSp] = useSearchParams(); const nav = useNavigate(); const toast = useToast(); const { can } = useSession();
  const [creating, setCreating] = useState(sp.get('novo') === '1');
  const [f, setF] = useState<any>({ q: sp.get('q') ?? '', kind: sp.get('kind') ?? '', purpose: sp.get('purpose') ?? '', status: '', tag: sp.get('tag') ?? '', city: sp.get('city') ?? '', price_min: '', price_max: '', area_min_ha: '', sort: 'recent', favorites: false, page: 1 });
  const { session } = useSession();
  const [view, setView] = useState<string>(() => { try { return localStorage.getItem('imobflow:view') || session?.theme?.cards || 'grade'; } catch { return session?.theme?.cards || 'grade'; } });
  const changeView = (v: string) => { setView(v); try { localStorage.setItem('imobflow:view', v); } catch { /* sem armazenamento */ } };
  const [more, setMore] = useState(false);
  const [cmp, setCmp] = useState<string[]>([]);
  const [showCmp, setShowCmp] = useState(false);
  const clean = { ...f, price_min: parseMoney(String(f.price_min)) ?? '', price_max: parseMoney(String(f.price_max)) ?? '', area_min_ha: f.area_min_ha ? String(f.area_min_ha).replace(',', '.') : '' };
  const st = useAsync(() => get(`/api/properties${qs({ ...clean, favorites: f.favorites ? 'true' : '', pageSize: 18 })}`), [JSON.stringify(f)]);
  const saved = useAsync(() => get('/api/saved-searches'), []);
  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v, page: 1 }));
  const fav = async (p: any) => { p.is_favorite ? await del(`/api/properties/${p.id}/favorite`) : await put(`/api/properties/${p.id}/favorite`); st.reload(); };
  const saveSearch = async () => { const name = prompt('Nome desta busca:'); if (!name) return; const { page, ...filters } = f; await post('/api/saved-searches', { name, filters }); toast('Busca salva'); saved.reload(); };
  return (
    <>
      <div className="page-head"><h1>Imóveis</h1><div className="seg right" role="group" aria-label="Exibição"><button className={view === 'grade' ? 'on' : ''} onClick={() => changeView('grade')}>Grade</button><button className={view === 'lista' ? 'on' : ''} onClick={() => changeView('lista')}>Lista</button></div>{can('properties.write') && <button className="btn primary" onClick={() => setCreating(true)}>+ Novo imóvel</button>}</div>
      <div className="card stack">
        <div className="row">
          <input style={{ flex: '2 1 200px' }} type="search" placeholder="Buscar por título, código, cidade, bairro" aria-label="Buscar imóveis" value={f.q} onChange={(e) => set('q', e.target.value)} />
          <select style={{ flex: '1 1 120px' }} aria-label="Tipo" value={f.kind} onChange={(e) => set('kind', e.target.value)}><option value="">Urbano e rural</option><option value="urbano">Urbano</option><option value="rural">Rural</option></select>
          <select style={{ flex: '1 1 120px' }} aria-label="Finalidade" value={f.purpose} onChange={(e) => set('purpose', e.target.value)}><option value="">Qualquer finalidade</option>{PURPOSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <button className="btn small" onClick={() => setMore(!more)} aria-expanded={more}>Mais filtros</button>
        </div>
        {more && <div className="grid g3">
          <Field label="Situação"><select value={f.status} onChange={(e) => set('status', e.target.value)}><option value="">Todas (exceto arquivados)</option>{STATUS.map((s) => <option key={s} value={s}>{L(s)}</option>)}</select></Field>
          <Field label="Localização"><select value={f.tag} onChange={(e) => set('tag', e.target.value)}><option value="">Qualquer</option>{TAGS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Cidade"><input value={f.city} onChange={(e) => set('city', e.target.value)} /></Field>
          <Field label="Preço mínimo (R$)"><input inputMode="decimal" value={f.price_min} onChange={(e) => set('price_min', e.target.value)} /></Field>
          <Field label="Preço máximo (R$)"><input inputMode="decimal" value={f.price_max} onChange={(e) => set('price_max', e.target.value)} /></Field>
          <Field label="Área mínima (hectares)" hint="Converte m² e alqueires automaticamente"><input inputMode="decimal" value={f.area_min_ha} onChange={(e) => set('area_min_ha', e.target.value)} /></Field>
        </div>}
        <div className="row">
          <select aria-label="Ordenar" value={f.sort} onChange={(e) => set('sort', e.target.value)} style={{ width: 'auto' }}><option value="recent">Mais recentes</option><option value="price_asc">Menor preço</option><option value="price_desc">Maior preço</option><option value="relevance">Relevância</option></select>
          <Toggle on={f.favorites} onChange={(v) => set('favorites', v)}>★ Favoritos</Toggle>
          <button className="btn small" onClick={saveSearch}>Salvar busca</button>
          {(saved.data ?? []).length > 0 && <select aria-label="Buscas salvas" style={{ width: 'auto' }} value="" onChange={(e) => { const s = saved.data.find((x: any) => x.id === e.target.value); if (s) setF({ ...f, ...s.filters, page: 1 }); }}><option value="">Buscas salvas…</option>{saved.data.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
          {cmp.length >= 2 && <button className="btn small primary right" onClick={() => setShowCmp(true)}>Comparar ({cmp.length})</button>}
        </div>
      </div>
      <Async state={st}>
        {(d) => !d.items.length ? <Empty>Nenhum imóvel com esses filtros.</Empty> : (
          <>
            <div className={`plist ${view}`}><div className="pgrid">
              {d.items.map((p: any) => (
                <article key={p.id} className="pcard">
                  <Link to={`/imoveis/${p.id}`} className="ph" aria-label={p.title}>
                    {p.cover_id ? <img src={`/api/files/${p.cover_id}/thumb?w=480`} alt="" loading="lazy" decoding="async" /> : <span className="ni"><Icon name="image" size={28} />Sem foto</span>}
                    <span className="bdg">{p.featured && <span className="f">Destaque</span>}{p.purposes.slice(0, 2).map((x: string) => <span key={x}>{L(x)}</span>)}</span>
                    {p.photo_count > 1 && <span className="cnt">{p.photo_count} fotos</span>}
                  </Link>
                  <Link to={`/imoveis/${p.id}`} className="bd">
                    <div className="pr">{brl(priceOf(p))}</div>
                    <h3>{p.title}</h3>
                    <div className="loc">{L(p.subtype)} · {[p.neighborhood, p.city && `${p.city}${p.state ? '/' + p.state : ''}`].filter(Boolean).join(', ') || 'Sem endereço'}</div>
                    <div className="fx">{p.bedrooms != null && <span><Icon name="bed" size={16} />{p.bedrooms} qts</span>}{p.bathrooms != null && <span><Icon name="bath" size={16} />{p.bathrooms} banh.</span>}{p.parking != null && <span><Icon name="car" size={16} />{p.parking} vagas</span>}<span><Icon name="area" size={16} />{areaTxt(p)}</span></div>
                  </Link>
                  <div className="ft"><span>{p.code}</span><StatusChip s={p.status} />{p.location_tags.map((x: string) => <span key={x} className="chip warn">{L(x)}</span>)}{p.published_at && <span className="chip ok">No site</span>}
                    <button className="btn small ghost right" aria-label={p.is_favorite ? 'Remover dos favoritos' : 'Favoritar'} onClick={() => fav(p)}>{p.is_favorite ? '★' : '☆'}</button>
                    <label className="small row"><input type="checkbox" checked={cmp.includes(p.id)} disabled={!cmp.includes(p.id) && cmp.length >= 4} onChange={(e) => setCmp(e.target.checked ? [...cmp, p.id] : cmp.filter((x) => x !== p.id))} /> Comparar</label></div>
                </article>
              ))}
            </div></div>
            <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={(page) => setF({ ...f, page })} />
          </>
        )}
      </Async>
      {showCmp && <Compare ids={cmp} onClose={() => setShowCmp(false)} />}
      {creating && <PropertyForm onClose={() => { setCreating(false); setSp({}); }} onSaved={(p) => { toast(`Imóvel ${p.code} cadastrado`); nav(`/imoveis/${p.id}`); }} />}
    </>
  );
}

function Compare({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const st = useAsync(() => get(`/api/properties-compare?ids=${ids.join(',')}`), [ids.join(',')]);
  const rows: [string, (p: any) => any][] = [['Código', (p) => p.code], ['Tipo', (p) => `${L(p.kind)} · ${L(p.subtype)}`], ['Finalidade', (p) => p.purposes.map(L).join(', ')], ['Cidade', (p) => p.city], ['Venda', (p) => brl(p.price_sale)], ['Aluguel', (p) => brl(p.price_rent)], ['Arrendamento', (p) => brl(p.price_lease)], ['Área', areaTxt], ['Quartos', (p) => p.bedrooms ?? '—'], ['Banheiros', (p) => p.bathrooms ?? '—'], ['Vagas', (p) => p.parking ?? '—'], ['Situação', (p) => L(p.status)]];
  return (
    <Modal title="Comparar imóveis" onClose={onClose}>
      <Async state={st}>{(list) => <div className="scroll-x"><table><thead><tr><th></th>{list.map((p: any) => <th key={p.id}>{p.title}</th>)}</tr></thead><tbody>{rows.map(([l, fn]) => <tr key={l}><th>{l}</th>{list.map((p: any) => <td key={p.id}>{fn(p)}</td>)}</tr>)}</tbody></table></div>}</Async>
    </Modal>
  );
}

export function PropertyDetail() {
  const { id } = useParams(); const nav = useNavigate(); const toast = useToast(); const { can } = useSession();
  const st = useAsync(() => get(`/api/properties/${id}`), [id]);
  const similar = useAsync(() => get(`/api/properties/${id}/similar`), [id]);
  const matches = useAsync(() => get(`/api/properties/${id}/matches`), [id]);
  const [editing, setEditing] = useState(false);
  const { ask, node } = useConfirm();
  const archive = async () => { if (await ask('Arquivar este imóvel? Ele sai das listas e da divulgação.', 'Arquivar')) { await del(`/api/properties/${id}`); toast('Imóvel arquivado'); nav('/imoveis'); } };
  return (
    <Async state={st}>
      {(p) => (
        <>
          <Link to="/imoveis" className="small">← Imóveis</Link>
          <div className="row"><h1>{p.title}</h1><StatusChip s={p.status} />{can('properties.write') && <><button className="btn small right" onClick={() => setEditing(true)}>Editar</button><button className="btn small danger" onClick={archive}>Arquivar</button></>}</div>
          <div className="chips" style={{ marginBottom: '.6rem' }}><span className="chip">{p.code}</span><span className="chip">{L(p.kind)} · {L(p.subtype)}</span>{p.purposes.map((x: string) => <span key={x} className="chip gray">{L(x)}</span>)}{p.location_tags.map((x: string) => <span key={x} className="chip warn">{L(x)}</span>)}{p.publish_authorized ? <span className="chip ok">Divulgação autorizada</span> : <span className="chip gray">Divulgação não autorizada</span>}</div>
          <div className="grid g2">
            <section className="card stack">
              <h2>Valores</h2>
              {p.price_sale != null && <div>Venda: <b>{brl(p.price_sale)}</b></div>}
              {p.price_rent != null && <div>Aluguel/temporada: <b>{brl(p.price_rent)}</b></div>}
              {p.price_lease != null && <div>Arrendamento: <b>{brl(p.price_lease)}</b></div>}
              {Object.entries(p.recurring_fees ?? {}).map(([k, v]) => <div key={k} className="small muted">{k}: {brl(v as number)}</div>)}
            </section>
            <section className="card stack">
              <h2>Local e medidas</h2>
              <div>{[p.address.logradouro, p.address.bairro, p.city && `${p.city}/${p.state}`, p.address.cep].filter(Boolean).join(' · ') || '—'}</div>
              {p.latitude != null && p.longitude != null && <a className="small" target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${p.latitude}&mlon=${p.longitude}#map=15/${p.latitude}/${p.longitude}`}>Ver no mapa ↗</a>}
              <div>Área total: <b>{areaTxt(p)}</b>{p.area_built ? ` · construída: ${p.area_built} m²` : ''}</div>
              {p.kind === 'urbano' && <div className="small muted">{p.bedrooms ?? '—'} quartos · {p.suites ?? '—'} suítes · {p.bathrooms ?? '—'} banheiros · {p.parking ?? '—'} vagas</div>}
            </section>
          </div>
          {p.description && <section className="card"><h2>Descrição</h2><p style={{ whiteSpace: 'pre-wrap' }}>{p.description}</p></section>}
          {p.features.length > 0 && <section className="card"><h2>Características</h2><div className="chips">{p.features.map((x: string) => <span key={x} className="chip gray">{x}</span>)}</div></section>}
          {p.kind === 'rural' && Object.keys(p.rural_details ?? {}).length > 0 && (
            <section className="card stack"><h2>Dados rurais</h2>
              {p.rural_details.water_sources && <div>Água: {p.rural_details.water_sources.join(', ')}</div>}
              {p.rural_details.activities && <div>Atividades: {p.rural_details.activities.join(', ')}</div>}
              {p.rural_details.visit_conditions && <div>Visita: {p.rural_details.visit_conditions}</div>}
              {p.rural_details.registry && <div className="alert warn small"><b>Documentação declarada pelo proprietário (não verificada):</b> {Object.entries(p.rural_details.registry).filter(([k, v]) => v && k !== 'verified').map(([k, v]) => `${k}: ${v === true ? 'sim' : v}`).join(' · ') || '—'}</div>}
            </section>
          )}
          {p.location_tags.includes('litoral') && Object.keys(p.coastal_details ?? {}).length > 0 && (
            <section className="card stack"><h2>Litoral / temporada</h2>
              {p.coastal_details.beach_distance_m != null && <div>Distância da praia: <b>{p.coastal_details.beach_distance_m} m</b> <span className="muted small">({p.coastal_details.beach_distance_source ?? 'origem não informada'})</span></div>}
              {p.coastal_details.guests_capacity != null && <div>Capacidade: {p.coastal_details.guests_capacity} hóspedes · {p.coastal_details.beds ?? '—'} camas</div>}
              {p.coastal_details.cleaning_fee != null && <div>Taxa de limpeza: {brl(p.coastal_details.cleaning_fee)}</div>}
              {p.coastal_details.sea_view && <div>🌊 Vista para o mar</div>}
            </section>
          )}
          <PortalCard propertyId={id!} canWrite={can('properties.write')} />
          <FilesPanel base={`/api/properties/${id}`} photos canWrite={can('properties.write')} canDocs={can('properties.internal')} />
          <VideosPanel id={id!} initial={p.videos ?? []} canWrite={can('properties.write')} />
          {p.owner && <section className="card"><h2>Proprietário</h2><Link to={`/pessoas/${p.owner.id}`}>{p.owner.name}</Link></section>}
          {p.internal_notes && <section className="card"><h2>Observações internas</h2><p>{p.internal_notes}</p></section>}
          <section className="card"><h2>Clientes compatíveis</h2>
            <Async state={matches}>{(m) => !m.length ? <Empty>Nenhum cliente com preferências cadastradas combina com este imóvel.</Empty> : <div className="list">{m.map((x: any) => <Link key={x.person.id} to={`/pessoas/${x.person.id}`} style={{ alignItems: 'flex-start' }}><span className="score">{x.score}%</span><div><b>{x.person.name}</b><div className="chips" style={{ marginTop: 4 }}>{x.reasons.map((r: string) => <span key={r} className="chip ok">{r}</span>)}{x.mismatches.map((r: string) => <span key={r} className="chip bad">{r}</span>)}</div></div></Link>)}</div>}</Async>
          </section>
          <section className="card"><h2>Imóveis semelhantes</h2>
            <Async state={similar}>{(s) => !s.length ? <Empty>Sem semelhantes disponíveis.</Empty> : <div className="list">{s.map((x: any) => <Link key={x.id} to={`/imoveis/${x.id}`}>{x.title}<span className="right small">{brl(priceOf(x))}</span></Link>)}</div>}</Async>
          </section>
          {editing && <PropertyForm initial={p} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); toast('Imóvel atualizado'); st.reload(); }} />}
          {node}
        </>
      )}
    </Async>
  );
}

/** Vídeos do imóvel por link (YouTube/Vimeo): aparecem na página do imóvel no site. */
function VideosPanel({ id, initial, canWrite }: { id: string; initial: any[]; canWrite: boolean }) {
  const toast = useToast();
  const link = (v: any) => v.url ?? (v.provider === 'youtube' ? `https://youtu.be/${v.id}` : `https://vimeo.com/${v.id}`);
  const [list, setList] = useState<any[]>(initial.map((v) => ({ url: link(v), title: v.title ?? '' })));
  const [url, setUrl] = useState(''); const [title, setTitle] = useState(''); const [err, setErr] = useState('');
  const save = async (next: any[]) => { setErr(''); try { const r = await put(`/api/properties/${id}/videos`, { videos: next }); setList(r.videos.map((v: any) => ({ url: link(v), title: v.title }))); toast('Vídeos atualizados'); return true; } catch (e) { setErr(e instanceof ApiError ? e.message : 'Erro'); return false; } };
  return (
    <section className="card stack"><h2>Vídeos ({list.length})</h2>
      {!list.length && <p className="small muted">Nenhum vídeo. Cole o link do tour no YouTube ou no Vimeo — ele aparece incorporado na página do imóvel.</p>}
      {list.map((v, i) => <div className="video-item" key={v.url + i}><Icon name="video" size={22} /><div style={{ flex: 1, minWidth: 0 }}><b>{v.title || 'Vídeo'}</b><div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><a href={v.url} target="_blank" rel="noreferrer">{v.url}</a></div></div>
        {canWrite && <button className="iconbtn" aria-label="Excluir vídeo" onClick={() => save(list.filter((_, j) => j !== i))}><Icon name="trash" size={18} /></button>}</div>)}
      {canWrite && list.length < 10 && <><div className="grid g2"><Field label="Link do vídeo"><input value={url} inputMode="url" onChange={(e) => setUrl(e.target.value)} placeholder="https://youtu.be/…" /></Field><Field label="Título (opcional)"><input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="Tour pela casa" /></Field></div>
        <button className="btn" disabled={!url.trim()} onClick={async () => { if (await save([...list, { url: url.trim(), title: title.trim() }])) { setUrl(''); setTitle(''); } }}><Icon name="plus" size={18} />Adicionar vídeo</button></>}
      {err && <div className="alert err" role="alert">{err}</div>}
    </section>
  );
}
