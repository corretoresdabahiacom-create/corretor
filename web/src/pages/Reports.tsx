import { useState } from 'react';
import { get, qs } from '../api';
import { useSession } from '../session';
import { Async, Empty, useAsync } from '../ui';
import { brl, L } from '../format';

const REPORTS: [string, string][] = [
  ['imoveis-status', 'Imóveis por situação e finalidade'], ['captacao', 'Captação por mês'], ['leads-origem', 'Contatos por origem'],
  ['conversao-etapa', 'Oportunidades que chegaram a cada etapa'], ['visitas', 'Visitas por situação'], ['propostas-andamento', 'Propostas em andamento'],
  ['concluidos', 'Negócios concluídos'], ['atividades-corretor', 'Atividades por corretor'], ['tempo-medio', 'Tempo médio até fechar'],
];
const fmt = (k: string, v: any) => (v == null ? '—' : /valor/.test(k) ? brl(v) : ['status', 'finalidade'].includes(k) ? L(v) : typeof v === 'number' ? v.toLocaleString('pt-BR') : String(v));

export default function Reports() {
  const { can } = useSession();
  const [name, setName] = useState('imoveis-status');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const st = useAsync(() => get(`/api/reports/${name}${qs({ from, to })}`), [name, from, to]);
  return (
    <>
      <h1>Relatórios</h1>
      <div className="card row" style={{ alignItems: 'end' }}>
        <select style={{ flex: '2 1 220px' }} aria-label="Relatório" value={name} onChange={(e) => setName(e.target.value)}>{REPORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <label className="row small">De <input type="date" style={{ width: 'auto' }} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="row small">Até <input type="date" style={{ width: 'auto' }} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        {can('data.export') && <a className="btn small right" href={`/api/reports/${name}/export.csv${qs({ from, to })}`}>⬇ Exportar CSV</a>}
      </div>
      <Async state={st}>
        {(d) => d.insufficient ? <Empty>Ainda não há dados suficientes para este relatório no período.</Empty> : (
          <div className="card scroll-x"><table className="rtable"><thead><tr>{Object.keys(d.rows[0]).filter((k) => k !== 'position').map((k) => <th key={k}>{k.replace(/_/g, ' ')}</th>)}</tr></thead><tbody>{d.rows.map((r: any, i: number) => <tr key={i}>{Object.entries(r).filter(([k]) => k !== 'position').map(([k, v]) => <td key={k} data-label={k.replace(/_/g, ' ')}>{fmt(k, v)}</td>)}</tr>)}</tbody></table></div>
        )}
      </Async>
      <p className="small muted">Todos os números vêm dos registros reais. Quando a amostra é pequena ou inexistente, o relatório avisa em vez de estimar.</p>
    </>
  );
}
