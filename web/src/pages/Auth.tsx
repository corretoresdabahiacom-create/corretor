import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, get, post } from '../api';
import { useSession } from '../session';
import { Field, Spinner, useAsync } from '../ui';

function useSubmit(fn: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await fn(); } catch (err) { setError(err instanceof ApiError ? err.message : 'Erro inesperado.'); } finally { setBusy(false); }
  };
  return { busy, error, submit };
}

const Box = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="auth-wrap">
    <aside className="auth-hero" aria-hidden="true"><h2>Imóveis, clientes e negócios da sua imobiliária em um só lugar.</h2><ul><li>Urbanos, rurais e no litoral</li><li>Site próprio com vitrine e filtros</li><li>Funciona no celular e pode ser instalado</li></ul></aside>
    <div className="auth"><div className="brand"><span className="brand-mark">IF</span>ImobFlow</div><div className="card stack"><h1 style={{ fontSize: '1.35rem', margin: 0 }}>{title}</h1>{children}</div></div>
  </div>
);

export function Login() {
  const { refresh } = useSession();
  const nav = useNavigate();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const { busy, error, submit } = useSubmit(async () => { await post('/api/auth/login', { email, password }); await refresh(); nav('/'); });
  return (
    <Box title="Entrar">
      <form className="stack" onSubmit={submit}>
        <Field label="E-mail"><input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Senha"><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {error && <div className="alert err" role="alert">{error}</div>}
        <button className="btn primary" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
      <div className="row small"><Link to="/esqueci-senha">Esqueci minha senha</Link><Link className="right" to="/cadastrar">Criar minha imobiliária</Link></div>
    </Box>
  );
}

export function Register() {
  const { refresh } = useSession();
  const nav = useNavigate();
  const [f, setF] = useState({ orgName: '', name: '', email: '', password: '' });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const { busy, error, submit } = useSubmit(async () => { await post('/api/auth/register', { ...f, ref: new URLSearchParams(location.search).get('ref') || undefined }); await refresh(); nav('/'); });
  return (
    <Box title="Criar minha imobiliária">
      <form className="stack" onSubmit={submit}>
        <Field label="Nome da imobiliária" hint="Ex.: Silva Imóveis"><input required value={f.orgName} onChange={set('orgName')} /></Field>
        <Field label="Seu nome"><input required autoComplete="name" value={f.name} onChange={set('name')} /></Field>
        <Field label="E-mail"><input type="email" required autoComplete="username" value={f.email} onChange={set('email')} /></Field>
        <Field label="Senha" hint="Mínimo de 10 caracteres, com letras e números."><input type="password" required autoComplete="new-password" value={f.password} onChange={set('password')} /></Field>
        {error && <div className="alert err" role="alert">{error}</div>}
        <button className="btn primary" disabled={busy}>{busy ? 'Criando…' : 'Criar conta gratuita'}</button>
      </form>
      <Link className="small" to="/entrar">Já tenho conta</Link>
    </Box>
  );
}

export function Forgot() {
  const [email, setEmail] = useState(''); const [done, setDone] = useState<any>(null);
  const { busy, error, submit } = useSubmit(async () => setDone(await post('/api/auth/forgot', { email })));
  return (
    <Box title="Recuperar senha">
      {done ? (
        <>
          <div className="alert ok">{done.message}</div>
          {done.devToken && (
            <div className="alert warn small">
              <b>MODO DESENVOLVIMENTO</b> — o envio de e-mail ainda não está configurado. Use este link: <Link to={`/redefinir/${done.devToken}`}>redefinir senha</Link>
            </div>
          )}
        </>
      ) : (
        <form className="stack" onSubmit={submit}>
          <Field label="E-mail da sua conta"><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          {error && <div className="alert err">{error}</div>}
          <button className="btn primary" disabled={busy}>Enviar instruções</button>
        </form>
      )}
      <Link className="small" to="/entrar">Voltar</Link>
    </Box>
  );
}

export function Reset() {
  const { token } = useParams(); const nav = useNavigate();
  const [password, setPassword] = useState('');
  const { busy, error, submit } = useSubmit(async () => { await post('/api/auth/reset', { token, password }); nav('/entrar'); });
  return (
    <Box title="Nova senha">
      <form className="stack" onSubmit={submit}>
        <Field label="Nova senha" hint="Mínimo de 10 caracteres, com letras e números."><input type="password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {error && <div className="alert err" role="alert">{error}</div>}
        <button className="btn primary" disabled={busy}>Salvar nova senha</button>
      </form>
    </Box>
  );
}

export function AcceptInvite() {
  const { token } = useParams(); const nav = useNavigate(); const { refresh } = useSession();
  const inv = useAsync(() => get(`/api/invites/preview/${token}`), [token]);
  const [name, setName] = useState(''); const [password, setPassword] = useState('');
  const { busy, error, submit } = useSubmit(async () => { await post('/api/invites/accept', { token, name, password }); await refresh(); nav('/'); });
  if (inv.loading) return <Spinner />;
  if (inv.error) return <Box title="Convite"><div className="alert err">{inv.error.message}</div><Link to="/entrar">Ir para o login</Link></Box>;
  return (
    <Box title={`Convite — ${inv.data.org_name}`}>
      <p className="muted small">Você foi convidado como <b>{inv.data.role}</b> ({inv.data.email}).</p>
      <form className="stack" onSubmit={submit}>
        <Field label="Seu nome"><input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Crie uma senha" hint="Mínimo de 10 caracteres, com letras e números."><input type="password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {error && <div className="alert err" role="alert">{error}</div>}
        <button className="btn primary" disabled={busy}>Aceitar convite</button>
      </form>
    </Box>
  );
}
