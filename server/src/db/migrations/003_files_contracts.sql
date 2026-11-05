CREATE TABLE files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
  person_id UUID REFERENCES people(id) ON DELETE CASCADE,
  contract_id UUID,
  category TEXT NOT NULL CHECK (category IN ('foto','documento')),
  doc_type TEXT,
  visibility TEXT NOT NULL DEFAULT 'privado' CHECK (visibility IN ('privado','publico')),
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  caption TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  is_cover BOOLEAN NOT NULL DEFAULT false,
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(property_id, person_id, contract_id) = 1)
);
CREATE INDEX files_prop_idx ON files(org_id, property_id, category, position);
CREATE INDEX files_person_idx ON files(org_id, person_id);
CREATE INDEX files_contract_idx ON files(org_id, contract_id);

CREATE TABLE contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('locacao','arrendamento')),
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','ativo','encerrado','rescindido')),
  property_id UUID NOT NULL REFERENCES properties(id),
  owner_person_id UUID NOT NULL REFERENCES people(id),
  counterparty_person_id UUID NOT NULL REFERENCES people(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  value_amount NUMERIC(14,2) NOT NULL CHECK (value_amount >= 0),
  value_period TEXT NOT NULL DEFAULT 'mensal' CHECK (value_period IN ('mensal','anual','safra')),
  due_day INTEGER CHECK (due_day BETWEEN 1 AND 31),
  deposit NUMERIC(14,2),
  adjustment_index TEXT,
  adjustment_month INTEGER CHECK (adjustment_month BETWEEN 1 AND 12),
  guarantee TEXT,
  rural_area_ha NUMERIC(14,4),
  rural_notes TEXT,
  notes TEXT,
  closed_reason TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date > start_date)
);
CREATE INDEX contracts_org_idx ON contracts(org_id, status, end_date);
ALTER TABLE files ADD CONSTRAINT files_contract_fk FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE;
