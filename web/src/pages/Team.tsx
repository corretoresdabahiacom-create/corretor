import { useState } from 'react';
import { ApiError, del, get, patch, post } from '../api';
import { Async, Empty, Field, useAsync, useConfirm, useToast } from '../ui';
import { dateBR, L } from '../format';

export default function Team() {
  const users = useAsync(() => get('/api/users'), []);
  const invites = useAsync(() => get('/api/invites'), []);
  const toast = useToast(); const { ask, node } = useConfirm();
  const [email, setEmail] = useState(''); const [role, setRole] = useState('corretor'); const [link, setLink] = useState(''); const [err, setErr] = useState('');
  const invite = async () => { setErr(''); setLink(''); try { const r = await post('/api/invites', { email, role }); setLink(r.link); setEmail(''); invites.reload(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Erro'); } };
  return (
    <>
      <h1>Equipe</h1>
      <section className="card stack">
        <h2>Convidar corretor ou colaborador</h2>
        <div className="grid g2">
          <Field label="E-mail"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Papel"><select value={role} onChange={(e) => setRole(e.target.value)}>{['gestor', 'corretor', 'assistente', 'consulta'].map((r) => <option key={r} value={r}>{L(r)}</option>)}</select></Field>
        </div>
        <button className="btn primary" disabled={!email} onClick={invite}>Gerar link de convite (válido por 7 dias)</button>
        {err && <div className="alert err">{err}</div>}
        {link && <div className="alert ok small">Envie este link ao convidado (o sistema não envia e-mail sozinho):<br /><input readOnly value={link} onFocus={(e) => e.target.select()} /><button className="btn small" onClick={() => { navigator.clipboard?.writeText(link); toast('Link copiado'); }}>Copiar</button></div>}
        <p className="small muted">Admin: tudo · Gestor: tudo menos configurar a organização · Corretor: seus clientes e negócios · Assistente: cadastros e agenda, sem documentos nem observações privadas · Consulta: somente leitura.</p>
      </section>
      <section className="card"><h2>Usuários</h2>
        <Async state={users}>{(u) => <div className="list">{u.map((x: any) => <div className="item" key={x.id}><div style={{ flex: 1 }}><b>{x.name}</b><div className="small muted">{x.email}</div></div><span className="chip">{L(x.role)}</span>{!x.active && <span className="chip bad">Desativado</span>}{x.role !== 'admin' && <button className="btn small" onClick={async () => { if (await ask(x.active ? `Desativar ${x.name}? A pessoa perde o acesso imediatamente.` : `Reativar ${x.name}?`, x.active ? 'Desativar' : 'Reativar')) { await patch(`/api/users/${x.id}`, { active: !x.active }); users.reload(); } }}>{x.active ? 'Desativar' : 'Reativar'}</button>}</div>)}</div>}</Async>
      </section>
      <section className="card"><h2>Convites</h2>
        <Async state={invites}>{(i) => !i.length ? <Empty>Nenhum convite enviado.</Empty> : <div className="list">{i.map((x: any) => { const st = x.accepted_at ? 'Aceito' : x.revoked_at ? 'Revogado' : new Date(x.expires_at) < new Date() ? 'Expirado' : 'Pendente'; return <div className="item" key={x.id}><div style={{ flex: 1 }}>{x.email}<div className="small muted">{L(x.role)} · expira {dateBR(x.expires_at)}</div></div><span className={`chip ${st === 'Aceito' ? 'ok' : st === 'Pendente' ? 'warn' : 'gray'}`}>{st}</span>{st === 'Pendente' && <button className="btn small danger" onClick={async () => { if (await ask('Revogar este convite? O link deixa de funcionar.', 'Revogar')) { await del(`/api/invites/${x.id}`); invites.reload(); } }}>Revogar</button>}</div>; })}</div>}</Async>
      </section>
      {node}
    </>
  );
}
