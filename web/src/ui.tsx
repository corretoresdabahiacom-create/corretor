import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from './api';

/* ---------- carregamento de dados com estados de loading/erro/vazio ---------- */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const alive = useRef(0);
  useEffect(() => {
    const id = ++alive.current;
    setLoading(true);
    fn()
      .then((d) => { if (id === alive.current) { setData(d); setError(null); } })
      .catch((e) => { if (id === alive.current) setError(e instanceof ApiError ? e : new ApiError(0, 'Erro inesperado.')); })
      .finally(() => { if (id === alive.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((t) => t + 1), setData };
}

export const Spinner = () => <div className="spinner" role="status" aria-label="Carregando" />;
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;
export function ErrorBox({ error, retry }: { error: ApiError; retry?: () => void }) {
  return (
    <div className="alert err" role="alert">
      {error.message}
      {error.status === 0 || error.status >= 500 ? retry && <> <button className="btn small" onClick={retry}>Tentar de novo</button></> : null}
    </div>
  );
}
export function Async<T>({ state, children, empty }: { state: ReturnType<typeof useAsync<T>>; children: (d: T) => ReactNode; empty?: (d: T) => boolean }) {
  if (state.loading && !state.data) return <Spinner />;
  if (state.error && !state.data) return <ErrorBox error={state.error} retry={state.reload} />;
  if (!state.data) return null;
  return <>{children(state.data)}</>;
}

/* ---------- toast ---------- */
const ToastCtx = createContext<(m: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState('');
  const show = useCallback((m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3200); }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && <div className="toast" role="status">{msg}</div>}
    </ToastCtx.Provider>
  );
}

/* ---------- modal e confirmação ---------- */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="row"><h2>{title}</h2><button className="btn small right" onClick={onClose} aria-label="Fechar">✕</button></div>
        {children}
      </div>
    </div>
  );
}

export function useConfirm() {
  const [state, setState] = useState<{ text: string; ok: string; resolve: (v: boolean) => void } | null>(null);
  const ask = useCallback((text: string, ok = 'Confirmar') => new Promise<boolean>((resolve) => setState({ text, ok, resolve })), []);
  const node = state ? (
    <Modal title="Confirmar" onClose={() => { state.resolve(false); setState(null); }}>
      <p>{state.text}</p>
      <div className="row">
        <button className="btn" onClick={() => { state.resolve(false); setState(null); }}>Voltar</button>
        <button className="btn danger right" autoFocus onClick={() => { state.resolve(true); setState(null); }}>{state.ok}</button>
      </div>
    </Modal>
  ) : null;
  return { ask, node };
}

/* ---------- formulário ---------- */
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
      {error && <span className="err" role="alert">{error}</span>}
    </label>
  );
}

export function Toggle({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <button type="button" className={`toggle ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => onChange(!on)}>
      {on ? '✓ ' : ''}{children}
    </button>
  );
}

export function MultiToggle({ options, value, onChange }: { options: [string, string][]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="chips">
      {options.map(([k, label]) => (
        <Toggle key={k} on={value.includes(k)} onChange={(on) => onChange(on ? [...value, k] : value.filter((x) => x !== k))}>{label}</Toggle>
      ))}
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="row" style={{ justifyContent: 'center', marginTop: '.6rem' }}>
      <button className="btn small" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ Anterior</button>
      <span className="muted small">Página {page} de {pages} · {total} registros</span>
      <button className="btn small" disabled={page >= pages} onClick={() => onPage(page + 1)}>Próxima ›</button>
    </div>
  );
}

export const StatusChip = ({ s }: { s: string }) => {
  const cls = ['disponivel', 'concluido', 'ativo'].includes(s) ? 'ok' : ['cancelado', 'indisponivel', 'perdido'].includes(s) ? 'bad' : ['reservado', 'em_negociacao', 'aguardando_retorno', 'em_preparacao'].includes(s) ? 'warn' : 'gray';
  return <span className={`chip ${cls}`}>{LABEL(s)}</span>;
};
import { L } from './format';
const LABEL = L;
