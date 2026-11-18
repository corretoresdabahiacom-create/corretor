// Índices de reajuste (IGP-M, IPCA, INPC, IGP-DI) pela API pública de séries do Banco Central (SGS, sem chave, gratuita).
// Cada série traz a variação MENSAL em %. O acumulado de 12 meses é composto: ∏(1 + v/100) − 1.
import { q, q1 } from '../db/pool.js';

export const SERIES = {
  IGPM: { code: 189, label: 'IGP-M (FGV)' },
  IPCA: { code: 433, label: 'IPCA (IBGE)' },
  INPC: { code: 188, label: 'INPC (IBGE)' },
  IGPDI: { code: 190, label: 'IGP-DI (FGV)' },
} as const;
export type SeriesKey = keyof typeof SERIES;

/** "IGP-M", "igpm", "IGPM acumulado" → IGPM. Texto livre sem índice conhecido → null. */
export function normalizeIndex(name?: string | null): SeriesKey | null {
  const s = (name ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  if (s.includes('IGPDI')) return 'IGPDI';
  if (s.includes('IGPM')) return 'IGPM';
  if (s.includes('IPCA')) return 'IPCA';
  if (s.includes('INPC')) return 'INPC';
  return null;
}

const monthStr = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
const addMonths = (ym: string, n: number) => { const [y, m] = ym.split('-').map(Number); return monthStr(new Date(Date.UTC(y, m - 1 + n, 1))); };

/** Resposta do SGS: [{ "data": "01/03/2025", "valor": "0.43" }]. Ignora linhas inválidas. */
export function parseSgs(json: unknown): { month: string; percent: number }[] {
  if (!Array.isArray(json)) return [];
  const out: { month: string; percent: number }[] = [];
  for (const r of json) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String((r as any)?.data ?? ''));
    const v = Number(String((r as any)?.valor ?? '').replace(',', '.'));
    if (!m || !Number.isFinite(v) || v < -20 || v > 50) continue; // variação mensal fora disso é dado corrompido
    out.push({ month: `${m[3]}-${m[2]}-01`, percent: v });
  }
  return out;
}

/** Variação acumulada em N meses terminando em `last` (inclusive). Faltou algum mês → complete=false. */
export function accumulate(byMonth: Map<string, number>, last: string, months = 12) {
  const list: { month: string; percent: number | null }[] = [];
  let factor = 1; const missing: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const ym = addMonths(last, -i); const v = byMonth.get(ym) ?? null;
    list.push({ month: ym, percent: v });
    if (v == null) missing.push(ym); else factor *= 1 + v / 100;
  }
  return { months: list, missing, complete: missing.length === 0, percent: Math.round((factor - 1) * 100 * 10000) / 10000 };
}

const STALE_MS = 12 * 3600_000;
const RETRY_MS = 15 * 60_000;

/** Busca a série no BCB e grava/atualiza no banco. Lança erro se a API não responder. */
export async function refreshSeries(key: SeriesKey, months = 40): Promise<number> {
  const since = new Date(); since.setUTCMonth(since.getUTCMonth() - months);
  const br = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
  const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${SERIES[key].code}/dados?formato=json&dataInicial=${br(since)}&dataFinal=${br(new Date())}`;
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`BCB respondeu ${res.status}`);
    const rows = parseSgs(await res.json());
    if (!rows.length) throw new Error('BCB não devolveu dados válidos');
    for (const r of rows) await q(`INSERT INTO economic_indices(series,ref_month,percent) VALUES ($1,$2,$3) ON CONFLICT (series,ref_month) DO UPDATE SET percent=EXCLUDED.percent, fetched_at=now()`, [key, r.month, r.percent]);
    await q(`INSERT INTO economic_indices_sync(series,last_attempt,last_ok,last_error) VALUES ($1,now(),now(),NULL) ON CONFLICT (series) DO UPDATE SET last_attempt=now(), last_ok=now(), last_error=NULL`, [key]);
    return rows.length;
  } catch (e) {
    await q(`INSERT INTO economic_indices_sync(series,last_attempt,last_error) VALUES ($1,now(),$2) ON CONFLICT (series) DO UPDATE SET last_attempt=now(), last_error=EXCLUDED.last_error`, [key, (e as Error).message.slice(0, 200)]);
    throw e;
  }
}

/** Atualiza só se os dados estão velhos/incompletos e não houve tentativa recente. Nunca lança: usa o que está no banco. */
export async function ensureFresh(key: SeriesKey, needLast: string): Promise<{ stale: boolean; error?: string }> {
  const sync = await q1<{ last_ok: Date | null; last_attempt: Date; last_error: string | null }>('SELECT last_ok,last_attempt,last_error FROM economic_indices_sync WHERE series=$1', [key]);
  const have = await q1<{ n: number }>('SELECT count(*)::int n FROM economic_indices WHERE series=$1 AND ref_month=$2', [key, needLast]);
  const fresh = sync?.last_ok && Date.now() - sync.last_ok.getTime() < STALE_MS;
  const recentTry = sync && Date.now() - sync.last_attempt.getTime() < RETRY_MS;
  if (have?.n && fresh) return { stale: false };
  if (recentTry && !have?.n) return { stale: true, error: sync?.last_error ?? undefined };
  if (have?.n && recentTry) return { stale: !fresh };
  try { await refreshSeries(key); return { stale: false }; } catch (e) { return { stale: true, error: (e as Error).message }; }
}

/** Acumulado de 12 meses para um reajuste com vigência em `effective` (YYYY-MM-DD): os 12 meses que terminam no mês anterior. */
export async function suggestion(key: SeriesKey, effective: string) {
  const last = addMonths(effective.slice(0, 7) + '-01', -1);
  const fresh = await ensureFresh(key, last);
  const rows = await q<{ ref_month: Date | string; percent: string }>('SELECT ref_month,percent FROM economic_indices WHERE series=$1 AND ref_month BETWEEN $2 AND $3', [key, addMonths(last, -11), last]);
  const byMonth = new Map(rows.map((r) => [typeof r.ref_month === 'string' ? r.ref_month.slice(0, 10) : `${r.ref_month.getFullYear()}-${String(r.ref_month.getMonth() + 1).padStart(2, '0')}-01`, Number(r.percent)]));
  const acc = accumulate(byMonth, last, 12);
  const sync = await q1<{ last_ok: Date | null }>('SELECT last_ok FROM economic_indices_sync WHERE series=$1', [key]);
  return { index: key, label: SERIES[key].label, source: `Banco Central do Brasil — SGS ${SERIES[key].code}`, effective_date: effective, from: acc.months[0].month, to: last, ...acc, stale: fresh.stale, error: fresh.error ?? null, updated_at: sync?.last_ok ?? null };
}
