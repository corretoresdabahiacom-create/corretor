-- Garantidores do contrato, vistorias (entrada/saída) e calendário de temporada.
CREATE TABLE IF NOT EXISTS contract_guarantors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('fiador','avalista','caucao','seguro_fianca','titulo_capitalizacao','outra')),
  person_id UUID REFERENCES people(id) ON DELETE SET NULL,  -- fiador/avalista cadastrado como pessoa
  description TEXT,                                          -- seguradora, banco, imóvel dado em garantia…
  policy_number TEXT,
  amount NUMERIC(14,2) CHECK (amount IS NULL OR amount >= 0),
  valid_until DATE,                                          -- apólice/título: vencimento
  status TEXT NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa','encerrada')),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contract_guarantors_contract ON contract_guarantors(org_id, contract_id);

CREATE TABLE IF NOT EXISTS inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('entrada','saida','periodica')),
  inspected_on DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','concluida')),
  items JSONB NOT NULL DEFAULT '[]'::jsonb,                  -- [{room,item,condition,notes}]
  general_notes TEXT,
  meters TEXT,                                               -- leituras de água/luz/gás
  keys_count TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inspections_contract ON inspections(org_id, contract_id, inspected_on);

CREATE TABLE IF NOT EXISTS property_stays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  guest_person_id UUID REFERENCES people(id) ON DELETE SET NULL,
  guest_name TEXT,
  guests INT CHECK (guests IS NULL OR guests > 0),
  start_date DATE NOT NULL,                                  -- check-in
  end_date DATE NOT NULL,                                    -- check-out (a noite do check-out fica livre)
  status TEXT NOT NULL DEFAULT 'confirmada' CHECK (status IN ('reserva','confirmada','cancelada','bloqueio')),
  source TEXT NOT NULL DEFAULT 'direto',
  total_amount NUMERIC(14,2) CHECK (total_amount IS NULL OR total_amount >= 0),
  deposit_amount NUMERIC(14,2) CHECK (deposit_amount IS NULL OR deposit_amount >= 0),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date > start_date)
);
CREATE INDEX IF NOT EXISTS property_stays_prop ON property_stays(property_id, start_date);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS ical_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS properties_ical_token ON properties(ical_token) WHERE ical_token IS NOT NULL;

ALTER TABLE contract_guarantors ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_stays ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE contract_guarantors, inspections, property_stays FROM PUBLIC;
