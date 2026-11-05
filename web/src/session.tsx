import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError, get } from './api';
import { applyTheme, type AppTheme } from './theme';

export interface Session {
  user: { id: string; name: string; email: string; role: string };
  org: { id: string; name: string; slug: string; plan: string };
  permissions: string[];
  appName: string;
  theme?: AppTheme;
}
interface Ctx { session: Session | null; loading: boolean; offline: boolean; refresh: () => Promise<void>; can: (p: string) => boolean }
const C = createContext<Ctx>({ session: null, loading: true, offline: false, refresh: async () => {}, can: () => false });
export const useSession = () => useContext(C);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const refresh = useCallback(async () => {
    // Sem internet não é "deslogado": mostra a tela de sem conexão e tenta de novo quando a rede voltar.
    try { const me = await get<Session>('/api/auth/me'); setSession(me); applyTheme(me.theme); setOffline(false); }
    catch (e) { if (e instanceof ApiError && e.status === 0) setOffline(true); else { setSession(null); applyTheme(null); setOffline(false); } }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const on = () => { if (offline) refresh(); }; window.addEventListener('online', on); return () => window.removeEventListener('online', on); }, [offline, refresh]);
  useEffect(() => {
    refresh();
    const h = () => setSession(null);
    window.addEventListener('imobflow:unauthorized', h);
    return () => window.removeEventListener('imobflow:unauthorized', h);
  }, [refresh]);
  // A interface só reflete o que o servidor autoriza; o servidor valida toda ação.
  const can = (p: string) => !!session?.permissions.includes(p);
  return <C.Provider value={{ session, loading, offline, refresh, can }}>{children}</C.Provider>;
}
