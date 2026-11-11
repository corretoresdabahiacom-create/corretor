-- Financeiro dos contratos: parcelas/pagamentos, histórico de reajustes e cadeia de renovações.
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS renewed_from UUID REFERENCES contracts(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS contract_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  due_date DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  paid_amount NUMERIC(14,2) CHECK (paid_amount IS NULL OR paid_amount > 0),
  paid_at DATE,
  method TEXT,
  note TEXT,
  generated BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((paid_amount IS NULL) = (paid_at IS NULL))
);
-- uma parcela gerada por vencimento; cobranças avulsas (generated=false) podem repetir a data
CREATE UNIQUE INDEX IF NOT EXISTS contract_payments_gen_uq ON contract_payments(contract_id, due_date) WHERE generated;
CREATE INDEX IF NOT EXISTS contract_payments_org_due ON contract_payments(org_id, due_date);

CREATE TABLE IF NOT EXISTS contract_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  effective_date DATE NOT NULL,
  index_name TEXT,
  percent NUMERIC(8,4) NOT NULL,
  old_amount NUMERIC(14,2) NOT NULL,
  new_amount NUMERIC(14,2) NOT NULL,
  note TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contract_adjustments_contract ON contract_adjustments(contract_id, effective_date);

ALTER TABLE contract_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_adjustments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE contract_payments, contract_adjustments FROM PUBLIC;
