import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../icons';
import { get } from '../api';
import { useSession } from '../session';
import { Async, Empty, useAsync } from '../ui';
import { ContractAlerts } from './Contracts';
import { brl, brlShort, dateBR, L, timeBR } from '../format';

const Section = ({ title, to, children }: { title: string; to?: string; children: React.ReactNode }) => (
  <section className="card">
    <div className="row"><h2>{title}</h2>{to && <Link className="right small" to={to}>Ver tudo</Link>}</div>
    {children}
  </section>
);

/** Capa do Início no mesmo estilo do site: foto (ou cor), saudação, busca rápida de imóveis e atalhos. */
function Hero() {
  const { session, can } = useSession(); const nav = useNavigate();
  const t = session!.theme; const [q, setQ] = useState(''); const [purpose, setPurpose] = useState(''); const [kind, setKind] = useState('');
  const h = new Date().getHours(); const hi = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const d0 = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }); const today = d0.charAt(0).toUpperCase() + d0.slice(1);
  const go = (e: React.FormEvent) => { e.preventDefault(); nav(`/imoveis?${new URLSearchParams(Object.entries({ q, purpose, kind }).filter(([, v]) => v)).toString()}`); };
  const img = t?.banner !== false ? t?.banner_url : null;
  return (
    <section className={`dash-hero ${img ? 'has-img' : ''}`}>
      {img && <img src={img} alt="" />}
      <div className="in">
        <h1>{hi}, {session!.user.name.split(' ')[0]}</h1>
        <p>{today} · {session!.org.name}</p>
        <form className="qsearch" onSubmit={go} role="search">
          <label>Buscar imóvel<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Título, código, cidade, bairro" /></label>
          <label>Finalidade<select value={purpose} onChange={(e) => setPurpose(e.target.value)}><option value="">Todas</option><option value="venda">Venda</option><option value="aluguel">Aluguel</option><option value="temporada">Temporada</option><option value="arrendamento">Arrendamento</option></select></label>
          <label>Tipo<select value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Urbano e rural</option><option value="urbano">Urbano</option><option value="rural">Rural</option></select></label>
          <button className="btn" type="submit"><Icon name="search" size={18} />Buscar</button>
        </form>
        <div className="acts">
          <Link className="btn primary" to="/pessoas?novo=1">+ Pessoa</Link>
          {can('properties.write') && <Link className="btn" to="/imoveis?novo=1">+ Imóvel</Link>}
          {can('deals.write') && <Link className="btn" to="/negocios?novo=1">+ Negócio</Link>}
          <Link className="btn" to="/agenda?novo=1">+ Compromisso</Link>
        </div>
      </div>
    </section>
  );
}

export default function Dashboard() {
  const { session, can } = useSession();
  const st = useAsync(() => get('/api/dashboard'), []);
  return (
    <>
      <Hero />
      <Async state={st}>
        {(d) => (
          <>
            {d.summary && (
              <div className="grid g3 kpis" style={{ marginBottom: '1rem' }}>
                <div className="card"><div className="kpi">{d.summary.open_deals}</div><div className="kpi-label">Negócios em andamento</div></div>
                <div className="card"><div className="kpi" title={brl(d.summary.open_estimated)}>{brlShort(d.summary.open_estimated)}</div><div className="kpi-label">Valor estimado em aberto</div></div>
                <div className="card"><div className="kpi">{d.summary.won_month}</div><div className="kpi-label">Fechados no mês ({brl(d.summary.won_month_value)})</div></div>
                <div className="card"><div className="kpi">{d.availableProperties}</div><div className="kpi-label">Imóveis disponíveis</div></div>
              </div>
            )}
            <div className="grid g2">
              {can('contracts.read') && <ContractAlerts />}
              <Section title="Agenda de hoje" to="/agenda">
                {!d.today.length ? <Empty>Nenhum compromisso hoje.</Empty> : <div className="list">{d.today.map((e: any) => <Link key={e.id} to="/agenda"><b>{timeBR(e.starts_at)}</b><span>{e.title}</span><span className="chip gray right">{L(e.type)}</span></Link>)}</div>}
              </Section>
              <Section title="Próximas visitas" to="/agenda">
                {!d.upcoming.length ? <Empty>Sem visitas agendadas.</Empty> : <div className="list">{d.upcoming.map((e: any) => <Link key={e.id} to="/agenda"><span><b>{dateBR(e.starts_at)} {timeBR(e.starts_at)}</b><br /><span className="small muted">{e.property_title ?? e.title}{e.person_name ? ` · ${e.person_name}` : ''}</span></span></Link>)}</div>}
              </Section>
              <Section title="Clientes aguardando retorno" to="/pessoas?status=aguardando_retorno">
                {!d.waiting.length ? <Empty>Ninguém aguardando retorno 🎉</Empty> : <div className="list">{d.waiting.map((p: any) => <Link key={p.id} to={`/pessoas/${p.id}`}>{p.name}<span className="small muted right">desde {dateBR(p.updated_at)}</span></Link>)}</div>}
              </Section>
              <Section title="Novos contatos (7 dias)" to="/pessoas">
                {!d.newContacts.length ? <Empty>Nenhum contato novo.</Empty> : <div className="list">{d.newContacts.map((p: any) => <Link key={p.id} to={`/pessoas/${p.id}`}>{p.name}<span className="chip gray right">{p.source ?? 'sem origem'}</span></Link>)}</div>}
              </Section>
              {can('deals.read') && (
                <Section title="Propostas em andamento" to="/negocios">
                  {!d.proposals.length ? <Empty>Nenhuma proposta em andamento.</Empty> : <div className="list">{d.proposals.map((x: any) => <Link key={x.id} to={`/negocios/${x.id}`}>{x.person_name}<span className="right small">{brl(x.negotiated_value ?? x.estimated_value)}</span></Link>)}</div>}
                </Section>
              )}
              {can('deals.read') && (
                <Section title="Tarefas atrasadas">
                  {!d.overdueTasks.length ? <Empty>Nenhuma tarefa atrasada.</Empty> : <div className="list">{d.overdueTasks.map((t: any) => <div className="item" key={t.id}><span>{t.title}</span><span className="chip bad right">{dateBR(t.due_at)}</span></div>)}</div>}
                </Section>
              )}
              <Section title="Contratos próximos do vencimento">
                <Empty>{d.contractsExpiring.note}</Empty>
              </Section>
            </div>
          </>
        )}
      </Async>
    </>
  );
}
