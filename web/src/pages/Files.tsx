import { useRef, useState } from 'react';
import { ApiError, del, get, patch, upload } from '../api';
import { Async, useAsync, useConfirm, useToast } from '../ui';

const DOC_TYPES: [string, string][] = [['matricula', 'Matrícula'], ['ccir', 'CCIR'], ['itr', 'ITR'], ['car', 'CAR'], ['escritura', 'Escritura'], ['iptu', 'IPTU'], ['contrato', 'Contrato'], ['procuracao', 'Procuração'], ['laudo', 'Laudo'], ['identidade', 'Documento de identidade'], ['comprovante', 'Comprovante'], ['outro', 'Outro']];
const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Galeria de fotos e documentos privados de um imóvel, pessoa ou contrato. */
export function FilesPanel({ base, photos = false, canWrite, canDocs = true }: { base: string; photos?: boolean; canWrite: boolean; canDocs?: boolean }) {
  const st = useAsync(() => get(`${base}/files`), [base]);
  const toast = useToast(); const { ask, node } = useConfirm();
  const videoIn = useRef<HTMLInputElement>(null); const photoIn = useRef<HTMLInputElement>(null); const docIn = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState('matricula'); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const send = async (files: FileList | null, category: 'foto' | 'documento' | 'video') => {
    if (!files?.length) return;
    setBusy(true); setErr('');
    try {
      for (const f of Array.from(files)) await upload(`${base}/files`, f, category === 'documento' ? { category, doc_type: docType } : { category });
      toast(files.length > 1 ? 'Arquivos enviados' : 'Arquivo enviado');
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Erro ao enviar'); }
    finally { setBusy(false); st.reload(); if (photoIn.current) photoIn.current.value = ''; if (videoIn.current) videoIn.current.value = ''; if (docIn.current) docIn.current.value = ''; }
  };
  const remove = async (f: any) => { if (await ask(`Excluir “${f.filename}”? Esta ação não pode ser desfeita.`, 'Excluir')) { await del(`/api/files/${f.id}`); st.reload(); } };
  return (
    <Async state={st}>
      {(files: any[]) => {
        const ph = files.filter((f) => f.category === 'foto'); const vids = files.filter((f) => f.category === 'video'); const docs = files.filter((f) => f.category === 'documento');
        return (
          <>
            {photos && (
              <section className="card stack">
                <div className="row"><h2>Fotos ({ph.length})</h2>{canWrite && <><input ref={photoIn} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => send(e.target.files, 'foto')} /><button className="btn small right" disabled={busy} onClick={() => photoIn.current?.click()}>{busy ? 'Enviando…' : '+ Adicionar fotos'}</button></>}</div>
                {err && <div className="alert err" role="alert">{err}</div>}
                {!ph.length ? <p className="muted small">Nenhuma foto ainda. Só fotos marcadas como públicas aparecem na página de divulgação.</p> : (
                  <div className="gallery">{ph.map((f) => (
                    <figure key={f.id}>
                      <img src={f.url} alt={f.caption || f.filename} loading="lazy" />
                      {f.is_cover && <span className="chip ok">Capa</span>}
                      <span className={`chip ${f.visibility === 'publico' ? 'warn' : 'gray'}`} style={{ left: 'auto', right: '.3rem' }}>{f.visibility === 'publico' ? 'Pública' : 'Privada'}</span>
                      {canWrite && <div className="row small"><button className="btn small" onClick={async () => { await patch(`/api/files/${f.id}`, { visibility: f.visibility === 'publico' ? 'privado' : 'publico' }); st.reload(); }}>{f.visibility === 'publico' ? 'Tornar privada' : 'Tornar pública'}</button>{!f.is_cover && <button className="btn small" onClick={async () => { await patch(`/api/files/${f.id}`, { is_cover: true }); st.reload(); }}>Definir capa</button>}<button className="btn small danger right" onClick={() => remove(f)} aria-label="Excluir foto">🗑</button></div>}
                    </figure>
                  ))}</div>
                )}
              </section>
            )}
            {photos && (
              <section className="card stack">
                <div className="row"><h2>Vídeos enviados ({vids.length})</h2>{canWrite && <><input ref={videoIn} type="file" accept="video/mp4,video/webm" hidden onChange={(e) => send(e.target.files, 'video')} /><button className="btn small right" disabled={busy || vids.length >= 3} onClick={() => videoIn.current?.click()}>{busy ? 'Enviando…' : '+ Enviar vídeo'}</button></>}</div>
                <p className="small muted">MP4 (H.264) ou WebM, até 30 MB, no máximo 3 por imóvel. O app não converte o vídeo: se ele não tocar, exporte como MP4/H.264. Para vídeos longos, prefira um link do YouTube ou Vimeo. Só vídeos marcados como públicos aparecem na página do imóvel.</p>
                {!vids.length ? <p className="muted small">Nenhum vídeo enviado.</p> : <div className="stack">{vids.map((f) => (
                  <div key={f.id} className="stack">
                    <video controls preload="metadata" playsInline src={f.url} style={{ width: '100%', maxHeight: '40vh', borderRadius: 'var(--radius-sm)', background: '#000' }} aria-label={f.caption || f.filename} />
                    <div className="row small"><span className="muted">{f.filename} · {kb(f.size_bytes)}</span><span className={`chip ${f.visibility === 'publico' ? 'warn' : 'gray'}`}>{f.visibility === 'publico' ? 'Público' : 'Privado'}</span>
                      {canWrite && <><button className="btn small right" onClick={async () => { await patch(`/api/files/${f.id}`, { visibility: f.visibility === 'publico' ? 'privado' : 'publico' }); st.reload(); }}>{f.visibility === 'publico' ? 'Tornar privado' : 'Tornar público'}</button><button className="btn small danger" onClick={() => remove(f)}>Excluir</button></>}</div>
                  </div>))}</div>}
              </section>
            )}
            {canDocs && (
              <section className="card stack">
                <div className="row"><h2>Documentos privados ({docs.length})</h2></div>
                <p className="small muted">Visíveis só para quem tem permissão. Nunca aparecem em páginas públicas. Aceita PDF, JPG, PNG ou WebP até 10 MB.</p>
                {canWrite && <div className="row"><select aria-label="Tipo de documento" value={docType} onChange={(e) => setDocType(e.target.value)} style={{ width: 'auto' }}>{DOC_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><input ref={docIn} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" hidden onChange={(e) => send(e.target.files, 'documento')} /><button className="btn small" disabled={busy} onClick={() => docIn.current?.click()}>{busy ? 'Enviando…' : '+ Anexar documento'}</button></div>}
                {!photos && err && <div className="alert err" role="alert">{err}</div>}
                {!docs.length ? <p className="muted small">Nenhum documento anexado.</p> : <div className="list">{docs.map((f) => <div className="item" key={f.id}><div style={{ flex: 1 }}><a href={f.url}>{f.filename}</a><div className="small muted">{DOC_TYPES.find(([k]) => k === f.doc_type)?.[1] ?? 'Documento'} · {kb(f.size_bytes)}</div></div>{canWrite && <button className="btn small danger" onClick={() => remove(f)}>Excluir</button>}</div>)}</div>}
              </section>
            )}
            {node}
          </>
        );
      }}
    </Async>
  );
}
