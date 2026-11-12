-- Multa e juros por atraso (estimativa exibida; não altera o valor da parcela).
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS late_fee_pct NUMERIC(5,2) NOT NULL DEFAULT 2 CHECK (late_fee_pct >= 0 AND late_fee_pct <= 20);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS late_interest_pct_month NUMERIC(5,2) NOT NULL DEFAULT 1 CHECK (late_interest_pct_month >= 0 AND late_interest_pct_month <= 10);
