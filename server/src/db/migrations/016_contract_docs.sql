-- Documentos de contrato gerados a partir de modelos, guardados na pasta (ficha) do cliente.
-- Texto próprio editável, histórico de versões e links de compartilhamento com validade.
CREATE TABLE IF NOT EXISTS contract_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  contract_id UUID REFERENCES contracts(id) ON DELETE SET NULL,
  template_key TEXT NOT NULL,
  template_version INT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','finalizado','assinado')),
  copied_from UUID REFERENCES contract_docs(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contract_docs_person ON contract_docs(org_id, person_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS contract_doc_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  doc_id UUID NOT NULL REFERENCES contract_docs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL,
  saved_by UUID REFERENCES users(id),
  saved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contract_doc_versions_doc ON contract_doc_versions(doc_id, saved_at DESC);

CREATE TABLE IF NOT EXISTS contract_doc_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  doc_id UUID NOT NULL REFERENCES contract_docs(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,       -- só o hash fica no banco; o link completo aparece uma vez
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  views INT NOT NULL DEFAULT 0,
  last_viewed_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contract_doc_shares_doc ON contract_doc_shares(doc_id);

ALTER TABLE contract_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_doc_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_doc_shares ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE contract_docs, contract_doc_versions, contract_doc_shares FROM PUBLIC;
