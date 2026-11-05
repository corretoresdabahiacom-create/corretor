import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { get, post } from './api';
import { useSession } from './session';
import { Spinner } from './ui';
import { Icon } from './icons';
import { usePwa } from './pwa';
import { AcceptInvite, Forgot, Login, Register, Reset } from './pages/Auth';
import Dashboard from './pages/Dashboard';
import { PeopleList, PersonDetail } from './pages/People';
import { PropertiesList, PropertyDetail } from './pages/Properties';
import { DealDetail, Pipeline } from './pages/Pipeline';
import Agenda from './pages/Agenda';
import Reports from './pages/Reports';
import Vitrine from './pages/Vitrine';
import Portal from './pages/Portal';
import Contracts from './pages/Contracts';
import Team from './pages/Team';
import AppThemePage from './pages/AppTheme';

function GlobalSearch() {
  const [term, setTerm] = useState('');
  const [res, setRes] = useState<any>(null);
  const nav = useNavigate();
  const loc = useLocation();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { setTerm(''); setRes(null); }, [loc.pathname]);
  useEffect(() => {
    if (term.trim().length < 2) { setRes(null); return; }
    const t = setTimeout(() => get('/api/search?q=' + encodeURIComponent(term.trim())).then(setRes).catch(() => setRes(null)), 250);
    return () => clearTimeout(t);
  }, [term]);
  const empty = res && !res.people.length && !res.properties.length && !res.deals.length;
  return (
    <div className="search" ref={box}>
      <Icon name="search" className="search-ico" /><input type="search" placeholder="Buscar pessoas, imóveis, negócios…" aria-label="Busca global" value={term} onChange={(e) => setTerm(e.target.value)} />
      {res && (
        <div className="results">
          {empty && <div className="empty">Nada encontrado para “{term}”.</div>}
          {res.people.length > 0 && <h4>Pessoas</h4>}
          {res.people.map((p: any) => <a key={p.id} href={`/pessoas/${p.id}`} onClick={(e) => { e.preventDefault(); nav(`/pessoas/${p.id}`); }}>{p.name}</a>)}
          {res.properties.length > 0 && <h4>Imóveis</h4>}
          {res.properties.map((p: any) => <a key={p.id} href={`/imoveis/${p.id}`} onClick={(e) => { e.preventDefault(); nav(`/imoveis/${p.id}`); }}>{p.code} · {p.title}</a>)}
          {res.deals.length > 0 && <h4>Negócios</h4>}
          {res.deals.map((d: any) => <a key={d.id} href={`/negocios/${d.id}`} onClick={(e) => { e.preventDefault(); nav(`/negocios/${d.id}`); }}>Negócio de {d.person_name}</a>)}
        </div>
      )}
    </div>
  );
}

function Reminders() {
  const [items, setItems] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const load = () => get('/api/reminders').then(setItems).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div style={{ position: 'relative' }}>
      <button className="iconbtn" onClick={() => setOpen(!open)} aria-label={`Lembretes (${items.length})`}><Icon name="bell" />{items.length > 0 && <b className="badge">{items.length}</b>}</button>
      {open && (
        <div className="card pop" style={{ position: 'absolute', right: 0, top: '115%', width: 'min(300px, 86vw)', zIndex: 40 }}>
          <h3>Lembretes</h3>
          {!items.length && <p className="muted small">Nenhum lembrete agora. Os avisos aparecem aqui dentro do aplicativo — não enviamos e-mail, SMS nem WhatsApp.</p>}
          {items.map((r) => <Link key={r.id} to="/agenda" className="small" style={{ display: 'block', padding: '.3rem 0' }} onClick={() => setOpen(false)}>{new Date(r.starts_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · {r.title}</Link>)}
        </div>
      )}
    </div>
  );
}

type NavItem = { to: string; label: string; icon: string; end?: boolean; show?: boolean };
function useNavItems() {
  const { can } = useSession();
  const groups: [string, NavItem[]][] = [
    ['Principal', [{ to: '/', label: 'Início', icon: 'home', end: true }, { to: '/agenda', label: 'Agenda', icon: 'calendar' }, { to: '/negocios', label: 'Funil', icon: 'funnel', show: can('deals.read') }]],
    ['Cadastros', [{ to: '/imoveis', label: 'Imóveis', icon: 'building' }, { to: '/pessoas', label: 'Pessoas', icon: 'users' }, { to: '/contratos', label: 'Contratos', icon: 'file', show: can('contracts.read') }]],
    ['Divulgação', [{ to: '/vitrine', label: 'Site e cartão', icon: 'store' }, { to: '/portal', label: 'Portal e contatos', icon: 'globe' }]],
    ['Gestão', [{ to: '/relatorios', label: 'Relatórios', icon: 'chart', show: can('reports.read') }, { to: '/equipe', label: 'Equipe', icon: 'gear', show: can('users.manage') }, { to: '/aparencia', label: 'Aparência do app', icon: 'brush', show: can('org.manage') }]],
  ];
  return groups.map(([g, items]) => [g, items.filter((i) => i.show !== false)] as [string, NavItem[]]);
}
const PRIMARY = ['/', '/agenda', '/imoveis', '/pessoas'];

function InstallItem({ onDone }: { onDone?: () => void }) {
  const pwa = usePwa(); const [hint, setHint] = useState(false);
  if (pwa.installed) return null;
  if (pwa.canInstall) return <button className="navbtn" onClick={async () => { await pwa.install(); onDone?.(); }}><Icon name="download" />Instalar o app</button>;
  if (pwa.iosHint) return <><button className="navbtn" onClick={() => setHint(!hint)}><Icon name="download" />Instalar no iPhone</button>{hint && <p className="small muted" style={{ padding: '0 .8rem' }}>Toque em <b>Compartilhar</b> (quadrado com seta) e depois em <b>Adicionar à Tela de Início</b>.</p>}</>;
  return null;
}

function UpdateBanner() {
  const pwa = usePwa();
  if (!pwa.update) return null;
  return <div className="updbar" role="status">Nova versão disponível. <button className="btn small" onClick={pwa.applyUpdate}>Atualizar agora</button></div>;
}

function OfflineBanner() {
  const [off, setOff] = useState(typeof navigator !== 'undefined' && !navigator.onLine);
  useEffect(() => { const on = () => setOff(false), of = () => setOff(true); window.addEventListener('online', on); window.addEventListener('offline', of); return () => { window.removeEventListener('online', on); window.removeEventListener('offline', of); }; }, []);
  return off ? <div className="offbar" role="status">Você está sem internet. Os dados aparecem quando a conexão voltar.</div> : null;
}

function Shell() {
  const { session, refresh } = useSession();
  const nav = useNavigate(); const loc = useLocation();
  const groups = useNavItems(); const all = groups.flatMap(([, i]) => i);
  const [more, setMore] = useState(false); const [search, setSearch] = useState(false);
  useEffect(() => { setMore(false); setSearch(false); window.scrollTo(0, 0); }, [loc.pathname]);
  const logout = async () => { await post('/api/auth/logout'); await refresh(); nav('/entrar'); };
  const current = all.filter((i) => (i.end ? loc.pathname === i.to : loc.pathname.startsWith(i.to))).pop();
  const inMore = current && !PRIMARY.includes(current.to);
  const initials = session!.user.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="app">
      <aside className="side" aria-label="Menu principal">
        <Link to="/" className="brand"><span className="brand-mark">IF</span>{session!.appName}</Link>
        <nav>{groups.map(([g, items]) => items.length ? <div key={g} className="navgroup"><div className="navlabel">{g}</div>{items.map((i) => <NavLink key={i.to} to={i.to} end={i.end}><Icon name={i.icon} />{i.label}</NavLink>)}</div> : null)}</nav>
        <div className="side-foot"><InstallItem /><div className="me"><span className="avatar">{initials}</span><span className="me-name">{session!.user.name}<small>{session!.org?.name ?? ''}</small></span></div><button className="navbtn" onClick={logout}><Icon name="logout" />Sair</button></div>
      </aside>
      <header className={`topbar ${search ? 'searching' : ''}`}>
        <Link to="/" className="brand mobile-only"><span className="brand-mark">IF</span><span className="brand-name">{session!.appName}</span></Link>
        <div className="top-search"><GlobalSearch /></div>
        <button className="iconbtn mobile-only" aria-label={search ? 'Fechar busca' : 'Buscar'} onClick={() => setSearch(!search)}><Icon name={search ? 'x' : 'search'} /></button>
        <Reminders />
      </header>
      <OfflineBanner /><UpdateBanner />
      <main className="page" id="conteudo">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/pessoas" element={<PeopleList />} />
          <Route path="/pessoas/:id" element={<PersonDetail />} />
          <Route path="/imoveis" element={<PropertiesList />} />
          <Route path="/imoveis/:id" element={<PropertyDetail />} />
          <Route path="/negocios" element={<Pipeline />} />
          <Route path="/negocios/:id" element={<DealDetail />} />
          <Route path="/agenda" element={<Agenda />} />
          <Route path="/vitrine" element={<Vitrine />} />
          <Route path="/portal" element={<Portal />} />
          <Route path="/contratos" element={<Contracts />} />
          <Route path="/relatorios" element={<Reports />} />
          <Route path="/equipe" element={<Team />} />
          <Route path="/aparencia" element={<AppThemePage />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
      <nav className="tabbar" aria-label="Atalhos">
        {all.filter((i) => PRIMARY.includes(i.to)).map((i) => <NavLink key={i.to} to={i.to} end={i.end}><Icon name={i.icon} size={22} /><span>{i.label}</span></NavLink>)}
        <button className={inMore || more ? 'active' : ''} onClick={() => setMore(!more)} aria-expanded={more}><Icon name="more" size={22} /><span>Mais</span></button>
      </nav>
      {more && (
        <div className="sheet-bg" onMouseDown={(e) => e.target === e.currentTarget && setMore(false)}>
          <div className="sheet" role="dialog" aria-label="Mais opções">
            <div className="sheet-grip" />
            <div className="me"><span className="avatar">{initials}</span><span className="me-name">{session!.user.name}<small>{session!.org?.name ?? ''}</small></span></div>
            <div className="sheet-grid">{all.filter((i) => !PRIMARY.includes(i.to)).map((i) => <NavLink key={i.to} to={i.to}><Icon name={i.icon} size={24} />{i.label}</NavLink>)}</div>
            <InstallItem onDone={() => setMore(false)} />
            <button className="navbtn" onClick={logout}><Icon name="logout" />Sair</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const { session, loading, offline, refresh } = useSession();
  if (loading) return <Spinner />;
  if (offline && !session) return (
    <div className="auth"><div className="brand"><span className="brand-mark">IF</span>ImobFlow</div><div className="card stack" role="alert"><h1 style={{ fontSize: '1.3rem', margin: 0 }}>Você está sem internet</h1><p className="muted">O ImobFlow precisa de conexão para mostrar seus dados atualizados. Assim que a internet voltar, a tela abre sozinha.</p><button className="btn primary" onClick={refresh}>Tentar de novo</button></div></div>
  );
  return (
    <Routes>
      <Route path="/entrar" element={session ? <Navigate to="/" /> : <Login />} />
      <Route path="/cadastrar" element={session ? <Navigate to="/" /> : <Register />} />
      <Route path="/esqueci-senha" element={<Forgot />} />
      <Route path="/redefinir/:token" element={<Reset />} />
      <Route path="/convite/:token" element={<AcceptInvite />} />
      <Route path="*" element={session ? <Shell /> : <Navigate to="/entrar" />} />
    </Routes>
  );
}
