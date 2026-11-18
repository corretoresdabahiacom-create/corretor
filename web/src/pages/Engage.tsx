import { useState } from 'react';
import { ApiError, del, get, patch, post } from '../api';
import { Async, Empty, Modal, useAsync, useConfirm, useToast } from '../ui';
import { dateBR } from '../format';

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Erro inesperado');
const wa = (text: string, phone?: string | null) => { const d = String(phone ?? '').replace(/\D/g, ''); return `https://wa.me/${d ? (d.startsWith('55') ? d : '55' + d) : ''}?text=${encodeURIComponent(text)}`; };

export function WhatsAppMessageCard({ propertyId, purposes }: { propertyId: string; purposes: string[] }) {
  const [purpose, setPurpose] = useState(purposes[0] ?? '');
  const [open, setOpen] = useState(false);
  const st = useAsync(() => (open ? get(`/api/properties/${propertyId}/whatsapp-message?purpose=${purpose}`) : Promise.resolve(null)), [propertyId, purpose, open]);
  const toast = useToast(); const [text, setText] = useState<string | null>(null);
  return (
    <section className="card stack"><h2>Mensagem pronta de WhatsApp</h2>
      <p className="small muted">Texto pronto com o essencial do imóvel (sem endereço exato) e o link da página, para você mandar ao cliente.</p>
      <button className="btn" onClick={() => { setText(null); setOpen(true); }}>Gerar mensagem</button>
      {open && <Modal title="Mensagem de WhatsApp" onClose={() => setOpen(false)}><Async state={st}>{(d: any) => d && (
        <div className="stack">
          {purposes.length > 1 && <select value={purpose} aria-label="Finalidade" onChange={(e) => { setPurpose(e.target.value); setText(null); }}>{purposes.map((p) => <option key={p} value={p}>{p}</option>)}</select>}
          {d.note && <div className="alert warn small">{d.note}</div>}
          <textarea rows={12} value={text ?? d.text} onChange={(e) => setText(e.target.value)} aria-label="Mensagem" />
          <div className="row"><button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(text ?? d.text); toast('Copiado'); } catch { toast('Selecione o texto e copie'); } }}>Copiar</button>
            <a className="btn primary" href={wa(text ?? d.text)} target="_blank" rel="noreferrer">Abrir no WhatsApp</a></div>
        </div>)}</Async></Modal>}
    </section>
  );
}

export function AlertsPanel() {
  const st = useAsync(() => get('/api/property-alerts'), []);
  const toast = useToast(); const { ask, node } = useConfirm();
  const act = async (fn: () => Promise<any>, ok?: string) => { try { await fn(); if (ok) toast(ok); st.reload(); } catch (e) { toast(errMsg(e)); } };
  return (
    <section className="card stack"><h2>Interessados em novos imóveis</h2>
      <p className="small muted">Pedidos feitos no seu site. Quando um imóvel novo combina, ele aparece aqui para você avisar pelo WhatsApp; nada é enviado automaticamente.</p>
      <Async state={st}>{(rows: any[]) => !rows.length ? <Empty>Ninguém pediu aviso ainda. O formulário fica no fim do seu site público.</Empty> : <div className="list">{rows.map((a) => (
        <div className="item" key={a.id} style={{ display: 'block', opacity: a.status === 'pausado' ? .6 : 1 }}>
          <div className="row"><div style={{ flex: 1 }}><b>{a.name}</b> <span className="small muted">{[a.phone, a.email].filter(Boolean).join(' · ')}</span>
            <div className="small muted">Procura: {[a.purpose, a.kind, a.city, a.max_price ? `até R$ ${Number(a.max_price).toLocaleString('pt-BR')}` : '', a.min_bedrooms ? `${a.min_bedrooms}+ quartos` : ''].filter(Boolean).join(' · ') || 'qualquer imóvel'} · desde {dateBR(a.created_at)}</div></div>
            <button className="btn small" onClick={() => act(() => patch(`/api/property-alerts/${a.id}`, { status: a.status === 'ativo' ? 'pausado' : 'ativo' }))}>{a.status === 'ativo' ? 'Pausar' : 'Reativar'}</button>
            <button className="btn small danger" onClick={async () => { if (await ask(`Excluir o pedido de ${a.name}? Os dados serão apagados.`, 'Excluir')) act(() => del(`/api/property-alerts/${a.id}`), 'Excluído'); }}>Excluir</button></div>
          {a.new_matches.length > 0 && <div className="stack" style={{ marginTop: 6 }}>
            {a.new_matches.map((m: any) => <div className="alert ok small" key={m.id}>Novo: <b>{m.title}</b>{a.phone ? <> · <a href={wa(m.text, a.phone)} target="_blank" rel="noreferrer">Avisar no WhatsApp</a></> : <> · sem telefone (use o e-mail {a.email})</>}</div>)}
            <button className="btn small" onClick={() => act(() => post(`/api/property-alerts/${a.id}/notified`), 'Marcado como avisado')}>Marcar como avisado</button></div>}
        </div>))}</div>}</Async>
      {node}
    </section>
  );
}
