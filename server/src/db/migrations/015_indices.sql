-- Índices econômicos oficiais (variação mensal, %) buscados na API pública de séries do Banco Central (SGS).
-- Dados públicos e iguais para todas as imobiliárias: tabela sem org_id; só o servidor escreve.
CREATE TABLE IF NOT EXISTS economic_indices (
  series TEXT NOT NULL,                 -- IGPM | IPCA | INPC | IGPDI
  ref_month DATE NOT NULL,              -- primeiro dia do mês de referência
  percent NUMERIC(8,4) NOT NULL,        -- variação do mês, em %
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (series, ref_month)
);
CREATE TABLE IF NOT EXISTS economic_indices_sync (
  series TEXT PRIMARY KEY,
  last_attempt TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_ok TIMESTAMPTZ,
  last_error TEXT
);
ALTER TABLE economic_indices ENABLE ROW LEVEL SECURITY;
ALTER TABLE economic_indices_sync ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE economic_indices, economic_indices_sync FROM PUBLIC;
