import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, post } from '../api';
import { Field } from '../ui';
import { useSession } from '../session';
import { L } from '../format';

export default function Account() {
  const { session, refresh } = useSession(); const nav = useNavigate();
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const isAdmin = session!.user.role === 'admin';
  const remove = async () => {
    setErr(''); setBusy(true);
    try { await post('/api/auth/account/delete', { password, confirm }); await refresh(); nav('/entrar'); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível excluir a conta.'); setBusy(false); }
  };
  return (
    <>
      <h1>Minha conta</h1>
      <section className="card stack">
        <h2>Dados</h2>
        <div><b>{session!.user.name}</b><div className="small muted">{session!.user.email} · {L(session!.user.role)} · {session!.org?.name}</div></div>
      </section>
      <section className="card stack" style={{ borderColor: 'var(--danger)' }}>
        <h2 style={{ color: 'var(--danger)' }}>Excluir conta</h2>
        {isAdmin
          ? <p>Você é o administrador. Excluir a conta <b>apaga a imobiliária inteira</b>: usuários, pessoas, imóveis, negócios, contratos, fotos, documentos, o site e o cartão. <b>Não há como desfazer.</b></p>
          : <p>Sua conta será desativada e seus dados pessoais (nome e e-mail) removidos. Você perde o acesso imediatamente. Os cadastros que você criou continuam com a imobiliária.</p>}
        <Field label="Sua senha"><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Field label="Para confirmar, digite EXCLUIR"><input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" /></Field>
        {err && <div className="alert err" role="alert">{err}</div>}
        <button className="btn danger" disabled={busy || !password || confirm.trim().toUpperCase() !== 'EXCLUIR'} onClick={remove}>{busy ? 'Excluindo…' : isAdmin ? 'Excluir imobiliária e minha conta' : 'Excluir minha conta'}</button>
      </section>
    </>
  );
}
